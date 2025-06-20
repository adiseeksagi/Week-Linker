import { App, TFile, TFolder, Notice } from 'obsidian';
import { WeeklyNotesSettings } from '../types/settings';
import { DateLogicService } from './DateLogicService';
import { formatDateWithCustomTokens } from '../utils/date';
import { escapeRegExp } from '../utils/regex';
import moment from 'moment';

export class VaultInteractionService {
    private app: App;
    private settings: WeeklyNotesSettings;
    private dateLogicService: DateLogicService;
    private readonly dailyLinkExtractionRegex = /!\[\[([^|\]]+?)(\.md)?([|\]][^\]]*)?\]\]/g;

    constructor(app: App, settings: WeeklyNotesSettings, dateLogicService: DateLogicService) {
        this.app = app;
        this.settings = settings;
        this.dateLogicService = dateLogicService;
    }

    updateSettings(settings: WeeklyNotesSettings) { this.settings = settings; }

    private escapeRegexForDelimiters(delimiter: string): string {
        return escapeRegExp(delimiter);
    }

    async addOrUpdateLinkInWeeklyNote(weeklyNotePath: string, dailyNoteDate: moment.Moment, dailyFileBasename: string): Promise<boolean> {
        const { linksStartDelimiter: START, linksEndDelimiter: END } = this.settings;
        if (!START || !END) {
            new Notice("Weekly Notes: Delimiters for links block are not configured. Please set them in settings.", 0);
            return false;
        }

        const weeklyNoteFolderPath = weeklyNotePath.substring(0, weeklyNotePath.lastIndexOf('/'));
        const weeklyFolderAbstract = this.app.vault.getAbstractFileByPath(weeklyNoteFolderPath);
        if (weeklyFolderAbstract && weeklyFolderAbstract instanceof TFile) {
            new Notice(`Weekly Notes Error: Path "${weeklyNoteFolderPath}" is a file.`, 0); return false;
        }
        if (!weeklyFolderAbstract) {
            await this.app.vault.createFolder(weeklyNoteFolderPath).catch(err => { console.error(err); throw err; });
        }
        let weeklyNoteFile = this.app.vault.getAbstractFileByPath(weeklyNotePath);
        if (weeklyNoteFile && weeklyNoteFile instanceof TFolder) {
            new Notice(`Weekly Notes Error: Path "${weeklyNotePath}" is a folder.`, 0); return false;
        }

        let rawContent = "";
        const mainHeadingText = this.dateLogicService.getWeeklyNoteHeading(dailyNoteDate);
        let mainHeadingPresentInOriginal = false;

        if (!weeklyNoteFile) {
            rawContent = mainHeadingText + "\n";
            if (this.settings.weeklyNoteLinksSectionHeading) {
                rawContent += "\n" + this.settings.weeklyNoteLinksSectionHeading + "\n";
            }
            rawContent += "\n" + START + "\n" + END + "\n";
            weeklyNoteFile = await this.app.vault.create(weeklyNotePath, rawContent);
            new Notice(`Weekly Notes: Created "${weeklyNotePath}".`, 3000);
            mainHeadingPresentInOriginal = true;
        } else if (weeklyNoteFile instanceof TFile) {
            rawContent = await this.app.vault.cachedRead(weeklyNoteFile);
            mainHeadingPresentInOriginal = rawContent.includes(mainHeadingText.trim().split('\n')[0]);
        } else {
            console.error("Weekly Notes: Could not get or create weekly note file:", weeklyNotePath); return false;
        }
        if (!(weeklyNoteFile instanceof TFile)) return false;

        const blockRegex = new RegExp(
            `^([\s\S]*?)(${this.escapeRegexForDelimiters(START)})\n?([\s\S]*?)\n?(${this.escapeRegexForDelimiters(END)})([\s\S]*)$`, "m"
        );
        let contentBeforeBlock = "";
        let currentLinksBlockContent = "";
        let contentAfterBlock = "";
        let hasBlock = false;

        const match = blockRegex.exec(rawContent);
        if (match) {
            hasBlock = true;
            contentBeforeBlock = match[1];
            currentLinksBlockContent = match[3];
            contentAfterBlock = match[5];
        }

        const existingBasenamesMap = new Map<string, moment.Moment>();
        if (hasBlock) {
            let linkMatch;
            this.dailyLinkExtractionRegex.lastIndex = 0;
            while ((linkMatch = this.dailyLinkExtractionRegex.exec(currentLinksBlockContent)) !== null) {
                const basename = linkMatch[1];
                const date = this.dateLogicService.getDailyNoteDateFromPath(basename, basename);
                if (date) {
                    existingBasenamesMap.set(basename, date);
                } else {
                    existingBasenamesMap.set(basename, moment(0));
                    console.warn(`Weekly Notes: Could not parse date for sorting from existing link: ${basename} in ${weeklyNotePath}`);
                }
            }
        }
        
        const newLinkAlreadyExists = existingBasenamesMap.has(dailyFileBasename);
        existingBasenamesMap.set(dailyFileBasename, dailyNoteDate);

        const sortedBasenames = Array.from(existingBasenamesMap.entries())
            .sort(([, dateA], [, dateB]) => dateA.valueOf() - dateB.valueOf())
            .map(([basename]) => basename);

        const newLinksBlockLines = sortedBasenames.map(basename => {
            const dateForThisLink = existingBasenamesMap.get(basename) || dailyNoteDate;
            let linkLine = this.settings.weeklyNoteLinkFormat.replace(/\{\{basename\}\}/g, basename);
            return formatDateWithCustomTokens(linkLine, dateForThisLink);
        });
        const newLinksBlockText = newLinksBlockLines.join('\n');

        if (newLinkAlreadyExists && hasBlock && currentLinksBlockContent.trim() === newLinksBlockText.trim()) {
            if (this.settings.ensureWeeklyNoteHeadingExists && !mainHeadingPresentInOriginal) {
                 const updatedContentWithHeading = mainHeadingText + "\n" + rawContent;
                 if (rawContent.trim() !== updatedContentWithHeading.trim()){
                    await this.app.vault.process(weeklyNoteFile, () => updatedContentWithHeading);
                    return true;
                 }
            }
            return false;
        }

        let updatedFileContent: string;
        let finalContentBeforeBlock = hasBlock ? contentBeforeBlock : rawContent;
        if (this.settings.ensureWeeklyNoteHeadingExists && !mainHeadingPresentInOriginal) {
            if (hasBlock) {
                finalContentBeforeBlock = mainHeadingText + "\n" + contentBeforeBlock;
            } else {
                finalContentBeforeBlock = mainHeadingText + "\n" + rawContent;
            }
        }

        if (hasBlock) {
            updatedFileContent = finalContentBeforeBlock +
                               START + '\n' +
                               newLinksBlockText + 
                               (newLinksBlockText.length > 0 ? '\n' : '') +
                               END +
                               contentAfterBlock;
        } else {
            let insertionPoint = -1;
            let contentToInsertInto = finalContentBeforeBlock; 

            if (this.settings.weeklyNoteLinksSectionHeading) {
                const sectionHeadingRegex = new RegExp(`^${escapeRegExp(this.settings.weeklyNoteLinksSectionHeading.trim())}(\r?\n|$)`, "m");
                const sectionMatch = sectionHeadingRegex.exec(contentToInsertInto);
                if (sectionMatch) {
                    insertionPoint = sectionMatch.index + sectionMatch[0].length;
                } else {
                    contentToInsertInto += (contentToInsertInto.endsWith('\n') ? '' : '\n') + 
                                           (contentToInsertInto.trim() === "" ? "" : "\n") + 
                                           this.settings.weeklyNoteLinksSectionHeading + '\n';
                    insertionPoint = contentToInsertInto.length; 
                }
            } else if (mainHeadingPresentInOriginal || (this.settings.ensureWeeklyNoteHeadingExists && !mainHeadingPresentInOriginal)) {
                 const firstLineEnd = contentToInsertInto.indexOf('\n');
                 if (firstLineEnd !== -1) {
                    insertionPoint = firstLineEnd + 1;
                 } else {
                    insertionPoint = contentToInsertInto.length;
                 }
            } else {
                insertionPoint = contentToInsertInto.length;
            }
            
            const blockToInsert = (insertionPoint > 0 && !contentToInsertInto.substring(0, insertionPoint).endsWith('\n\n') && !contentToInsertInto.substring(0, insertionPoint).endsWith('\n') ? '\n' : '') +
                                 START + '\n' +
                                 newLinksBlockText +
                                 (newLinksBlockText.length > 0 ? '\n' : '') +
                                 END + '\n';

            updatedFileContent = contentToInsertInto.substring(0, insertionPoint) +
                                 blockToInsert +
                                 contentToInsertInto.substring(insertionPoint);
        }
        
        updatedFileContent = updatedFileContent.replace(/\r\n/g, '\n').trimEnd() + '\n';
        const normalizedRawContent = rawContent.replace(/\r\n/g, '\n').trimEnd() + '\n';

        if (normalizedRawContent !== updatedFileContent) {
            await this.app.vault.process(weeklyNoteFile, () => updatedFileContent);
            return true;
        }
        return false;
    }
    
    async removeLinkFromWeeklyNote(weeklyNotePath: string, dailyNoteDateContext: moment.Moment, dailyFileBasenameToRemove: string): Promise<void> {
        const noteFile = this.app.vault.getAbstractFileByPath(weeklyNotePath);
        if (!(noteFile instanceof TFile)) return;

        const { linksStartDelimiter: START, linksEndDelimiter: END } = this.settings;
        if (!START || !END) {
            new Notice("Weekly Notes: Delimiters not configured. Cannot reliably remove link.", 0);
            return; 
        }

        const rawContent = await this.app.vault.read(noteFile);
        const blockRegex = new RegExp(
            `^([\s\S]*?)(${this.escapeRegexForDelimiters(START)})\n?([\s\S]*?)\n?(${this.escapeRegexForDelimiters(END)})([\s\S]*)$`, "m"
        );
        const match = blockRegex.exec(rawContent);

        if (!match) return;

        const contentBeforeBlock = match[1];
        const currentLinksBlockContent = match[3];
        const contentAfterBlock = match[5];
        
        const existingBasenamesMap = new Map<string, moment.Moment>();
        let linkMatch;
        this.dailyLinkExtractionRegex.lastIndex = 0; 
        while ((linkMatch = this.dailyLinkExtractionRegex.exec(currentLinksBlockContent)) !== null) {
            const basename = linkMatch[1];
            if (basename !== dailyFileBasenameToRemove) {
                const date = this.dateLogicService.getDailyNoteDateFromPath(basename, basename);
                if (date) existingBasenamesMap.set(basename, date);
                else existingBasenamesMap.set(basename, moment(0));
            }
        }

        const initialLinkCountInBlock = (currentLinksBlockContent.match(this.dailyLinkExtractionRegex) || []).length;
        if (existingBasenamesMap.size === initialLinkCountInBlock && initialLinkCountInBlock > 0) return;
        
        const sortedBasenames = Array.from(existingBasenamesMap.entries())
            .sort(([, dateA], [, dateB]) => dateA.valueOf() - dateB.valueOf())
            .map(([basename]) => basename);

        const newLinksBlockLines = sortedBasenames.map(basename => {
            const dateForThisLink = existingBasenamesMap.get(basename) || dailyNoteDateContext; 
            let linkLine = this.settings.weeklyNoteLinkFormat.replace(/\{\{basename\}\}/g, basename);
            return formatDateWithCustomTokens(linkLine, dateForThisLink);
        });
        const newLinksBlockText = newLinksBlockLines.join('\n');

        const updatedFileContent = contentBeforeBlock +
                               START + '\n' +
                               newLinksBlockText +
                               (newLinksBlockText.length > 0 ? '\n' : '') +
                               END +
                               contentAfterBlock;
        
        const normalizedUpdatedContent = updatedFileContent.replace(/\r\n/g, '\n').trimEnd() + '\n';
        const normalizedRawContent = rawContent.replace(/\r\n/g, '\n').trimEnd() + '\n';

        if (normalizedRawContent !== normalizedUpdatedContent) {
            await this.app.vault.process(noteFile, () => normalizedUpdatedContent);
            new Notice(`Weekly Notes: Removed link for "${dailyFileBasenameToRemove}" from "${weeklyNotePath}".`, 3000);
        }
    }
} 