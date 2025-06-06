import {
    App,
    Plugin,
    TFile,
    TFolder,
    moment,
    Notice,
    PluginSettingTab,
    Setting,
    debounce,
    normalizePath
} from 'obsidian';

// --- Interfaces ---
interface WeeklyNotesSettings {
    dailyNoteFormat: string;
    dailyNoteFilenameRegex: string;
    weeklyNoteFolderPath: string;
    weeklyNoteFilenameFormat: string;
    weeklyNoteHeadingFormat: string;
    weeklyNoteLinkFormat: string; // Format for a SINGLE link, e.g., "- ![[{{basename}}]]"
    ensureWeeklyNoteHeadingExists: boolean;
    autoProcessOnCreate: boolean;
    autoProcessOnStartup: boolean;
    debounceDelay: number;
    runBackfillOnNextStartup: boolean;
    weeklyNoteLinksSectionHeading: string;
    linksStartDelimiter: string;
    linksEndDelimiter: string;
}

const DEFAULT_SETTINGS: WeeklyNotesSettings = {
    dailyNoteFormat: "YYYY-MM-DD",
    dailyNoteFilenameRegex: "",
    weeklyNoteFolderPath: "{{GGGG}}/Weekly/",
    weeklyNoteFilenameFormat: "{{GGGG}}-W{{WW}}.md",
    weeklyNoteHeadingFormat: "# Week {{W}} ({{MMMM D}} to {{MMMM D, add=6,days}})",
    weeklyNoteLinkFormat: "- ![[{{basename}}]]",
    ensureWeeklyNoteHeadingExists: true,
    autoProcessOnCreate: true,
    autoProcessOnStartup: false,
    debounceDelay: 1500,
    runBackfillOnNextStartup: false,
    weeklyNoteLinksSectionHeading: "## Daily Notes",
    linksStartDelimiter: "<!-- DAILY LINKS START -->",
    linksEndDelimiter: "<!-- DAILY LINKS END -->",
};

// --- Utility Functions ---
function escapeRegExp(string: string): string {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function formatDateWithCustomTokens(formatString: string, date: moment.Moment): string {
     return formatString.replace(/\{\{([^}]+)\}\}/g, (_, tokenExpression) => {
        const parts = tokenExpression.split(',').map((s: string) => s.trim());
        const momentToken = parts[0];
        let tempDate = date.clone();

        if (parts.length > 1) {
            for (let i = 1; i < parts.length; i++) {
                const [operation, param] = parts[i].split('=').map((s: string) => s.trim());
                if (param) {
                    const paramParts = param.split(/\s+/);
                    const numVal = parseInt(paramParts[0]);
                    const unitOrArg = paramParts.length > 1 ? paramParts[1] : paramParts[0];

                    if (operation === 'add' && !isNaN(numVal) && unitOrArg) {
                        tempDate.add(numVal, unitOrArg as moment.DurationInputArg2);
                    } else if (operation === 'subtract' && !isNaN(numVal) && unitOrArg) {
                        tempDate.subtract(numVal, unitOrArg as moment.DurationInputArg2);
                    } else if (operation === 'startOf' && unitOrArg) {
                        tempDate = tempDate.startOf(unitOrArg as moment.unitOfTime.StartOf);
                    } else if (operation === 'endOf' && unitOrArg) {
                        tempDate = tempDate.endOf(unitOrArg as moment.unitOfTime.StartOf);
                    }
                }
            }
        }
        return tempDate.format(momentToken);
    });
}


export default class WeeklyNotesPluginV2 extends Plugin {
    settings: WeeklyNotesSettings;
    private debouncedProcessDailyNote: (dailyFile: TFile) => void;
    private dateLogicService: DateLogicService;
    private vaultInteractionService: VaultInteractionService;

    async onload() {
        await this.loadSettings();
        console.log('Loading Weekly Notes Plugin (PR Feedback Fixes)');

        this.dateLogicService = new DateLogicService(this.settings);
        this.vaultInteractionService = new VaultInteractionService(this.app, this.settings, this.dateLogicService);

        this.debouncedProcessDailyNote = debounce(
            (dailyFile: TFile) => { this.processDailyNote(dailyFile); },
            this.settings.debounceDelay, true
        );

        if (this.settings.autoProcessOnCreate) {
            this.registerEvent(
                this.app.vault.on('create', (file) => {
                    if (file instanceof TFile && file.extension === 'md') {
                        this.debouncedProcessDailyNote(file);
                    }
                })
            );
        }
        
        this.registerEvent(
            this.app.vault.on('rename', async (file, oldPath) => {
                if (file instanceof TFile && file.extension === 'md') {
                    const newDailyNoteDate = this.dateLogicService.getDailyNoteDate(file);
                    if (newDailyNoteDate) {
                        await this.processDailyNote(file);
                    }
                    const oldFileBasename = oldPath.substring(oldPath.lastIndexOf('/') + 1, oldPath.lastIndexOf('.'));
                    const oldDailyNoteDate = this.dateLogicService.getDailyNoteDateFromPath(oldPath, oldFileBasename);
                    if (oldDailyNoteDate) {
                        const oldWeeklyNotePath = this.dateLogicService.getWeeklyNotePath(oldDailyNoteDate);
                        if (oldWeeklyNotePath) {
                            await this.vaultInteractionService.removeLinkFromWeeklyNote(oldWeeklyNotePath, oldDailyNoteDate, oldFileBasename);
                        }
                    }
                }
            })
        );

        this.registerEvent(
            this.app.vault.on('delete', async (file) => {
                if (file instanceof TFile && file.extension === 'md') {
                    const dailyNoteDate = this.dateLogicService.getDailyNoteDateFromPath(file.path, file.basename);
                    if (dailyNoteDate) {
                        const weeklyNotePath = this.dateLogicService.getWeeklyNotePath(dailyNoteDate);
                        if (weeklyNotePath) {
                           await this.vaultInteractionService.removeLinkFromWeeklyNote(weeklyNotePath, dailyNoteDate, file.basename);
                        }
                    }
                }
            })
        );

        this.app.workspace.onLayoutReady(async () => {
            if (this.settings.autoProcessOnStartup || this.settings.runBackfillOnNextStartup) {
                new Notice("Weekly Notes: Startup processing initiated...", 3000);
                await this.backfillWeeklyNotes(false);
                if (this.settings.runBackfillOnNextStartup) {
                    this.settings.runBackfillOnNextStartup = false;
                    await this.saveSettings(); 
                    new Notice("Weekly Notes: One-time startup backfill complete.", 5000);
                } else if (this.settings.autoProcessOnStartup) {
                     new Notice("Weekly Notes: Startup processing complete.", 5000);
                }
            }
        });

        this.addCommand({
            id: 'force-backfill-weekly-notes-safe',
            name: 'Backfill all daily notes to weekly notes (Safe)',
            callback: async () => {
                const notice = new Notice("Weekly Notes: Manual backfill initiated. This may take some time...", 0);
                try {
                    const summary = await this.backfillWeeklyNotes(true);
                    notice.setMessage(`Weekly Notes: Manual backfill complete. ${summary.dailyNotesProcessed} daily notes processed, ${summary.weeklyNotesUpdated} weekly notes updated/created. ${summary.errors} errors.`);
                } catch (e) {
                    notice.setMessage(`Weekly Notes: Backfill failed. ${e.message}`);
                } finally {
                    setTimeout(() => notice.hide(), 15000);
                }
            }
        });
        
        this.addCommand({
            id: 'process-current-daily-note-to-weekly-safe',
            name: "Process current daily note for weekly linking (Safe)",
            checkCallback: (checking: boolean) => {
                const currentFile = this.app.workspace.getActiveFile();
                if (currentFile) {
                    if (!checking) {
                        this.processDailyNote(currentFile);
                    }
                    return true;
                }
                return false;
            }
        });

        this.addSettingTab(new WeeklyNotesSettingTabV2(this.app, this));
    }

    async processDailyNote(dailyFile: TFile): Promise<boolean> {
        const dailyNoteDate = this.dateLogicService.getDailyNoteDate(dailyFile);
        if (!dailyNoteDate) return false;
        
        const weeklyNotePath = this.dateLogicService.getWeeklyNotePath(dailyNoteDate);
        if (!weeklyNotePath) {
            new Notice("Weekly Notes: Could not determine weekly note path. Check folder/filename format settings.", 0);
            return false;
        }

        try {
            return await this.vaultInteractionService.addOrUpdateLinkInWeeklyNote(
                weeklyNotePath,
                dailyNoteDate,
                dailyFile.basename
            );
        } catch (error) {
            new Notice(`Weekly Notes Error: Processing "${dailyFile.name}" failed. ${error.message}`, 0);
            console.error(`Weekly Notes: Error processing "${dailyFile.name}" for "${weeklyNotePath}":`, error);
            return false;
        }
    }

    async backfillWeeklyNotes(verbose: boolean): Promise<{ dailyNotesProcessed: number, weeklyNotesUpdated: number, errors: number }> {
        const files = this.app.vault.getMarkdownFiles();
        let dailyNotesProcessed = 0;
        let weeklyNotesUpdated = 0;
        let errorCount = 0;
        const modifiedWeeklyNotes = new Set<string>();

        for (const file of files) {
            const dailyNoteDate = this.dateLogicService.getDailyNoteDate(file);
            if (dailyNoteDate) {
                dailyNotesProcessed++;
                try {
                    const weeklyNotePath = this.dateLogicService.getWeeklyNotePath(dailyNoteDate);
                    if(weeklyNotePath){
                       const updated = await this.vaultInteractionService.addOrUpdateLinkInWeeklyNote(
                           weeklyNotePath,
                           dailyNoteDate,
                           file.basename
                       );
                       if(updated) {
                           modifiedWeeklyNotes.add(weeklyNotePath);
                       }
                       if (verbose && updated) new Notice(`Weekly Notes: Processed ${file.basename} during backfill.`, 2000);
                    }
                } catch (e) {
                    errorCount++;
                    if (verbose) new Notice(`Weekly Notes: Error backfilling ${file.basename}: ${e.message}`, 5000);
                    console.error(`Weekly Notes: Error during backfill for ${file.name}:`, e);
                }
            }
        }
        weeklyNotesUpdated = modifiedWeeklyNotes.size;
        return { dailyNotesProcessed, weeklyNotesUpdated, errors: errorCount };
    }

    onunload() {
        console.log('Unloading Weekly Notes Plugin');
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
        if (this.dateLogicService) this.dateLogicService.updateSettings(this.settings);
        if (this.vaultInteractionService) this.vaultInteractionService.updateSettings(this.settings);
    }

    async saveSettings() {
        await this.saveData(this.settings);
        if (this.dateLogicService) this.dateLogicService.updateSettings(this.settings);
        if (this.vaultInteractionService) this.vaultInteractionService.updateSettings(this.settings);
        this.debouncedProcessDailyNote = debounce(
            (dailyFile: TFile) => { this.processDailyNote(dailyFile); },
            this.settings.debounceDelay, true
        );
    }
}

class DateLogicService {
    private settings: WeeklyNotesSettings;
    constructor(settings: WeeklyNotesSettings) { this.settings = settings; }
    updateSettings(settings: WeeklyNotesSettings) { this.settings = settings; }

    getDailyNoteDate(file: TFile): moment.Moment | null {
        return this.getDailyNoteDateFromPath(file.path, file.basename);
    }
    
    getDailyNoteDateFromPath(filePath: string, fileBasename: string): moment.Moment | null {
        let dateStringForParsing: string | undefined = undefined;
        const fileName = filePath.substring(filePath.lastIndexOf('/') + 1);
        if (this.settings.dailyNoteFilenameRegex) {
            try {
                const regex = new RegExp(this.settings.dailyNoteFilenameRegex);
                const match = regex.exec(fileName); 
                if (match && match.groups && match.groups.dateString) {
                    dateStringForParsing = match.groups.dateString;
                } else if (match) {
                    dateStringForParsing = fileBasename;
                } else { return null; }
            } catch (e) {
                new Notice(`Weekly Notes: Invalid daily note filename regex: ${e.message}.`, 0);
                console.error("Weekly Notes: Invalid daily note filename regex:", e);
                return null;
            }
        } else {
            dateStringForParsing = fileBasename;
        }
        if (!dateStringForParsing) return null;
        const useStrictParsing = /^[YMD\W]+$/.test(this.settings.dailyNoteFormat);
        const m = moment(dateStringForParsing, this.settings.dailyNoteFormat, useStrictParsing); 
        return m.isValid() ? m : null;
    }

    getWeeklyNotePath(date: moment.Moment): string | null {
        if (!this.settings.weeklyNoteFolderPath || !this.settings.weeklyNoteFilenameFormat) {
            console.error("Weekly Notes: Folder or filename format for weekly notes is undefined.");
            return null;
        }
        try {
            const folderPath = formatDateWithCustomTokens(this.settings.weeklyNoteFolderPath, date);
            const fileName = formatDateWithCustomTokens(this.settings.weeklyNoteFilenameFormat, date);
            return normalizePath(`${folderPath}/${fileName}`);
        } catch (e) {
             new Notice(`Weekly Notes: Error formatting weekly note path/filename: ${e.message}`, 5000);
             console.error("Weekly Notes: Error formatting weekly note path/filename", e);
             return null;
        }
    }

    getWeeklyNoteHeading(date: moment.Moment): string {
         try {
            return formatDateWithCustomTokens(this.settings.weeklyNoteHeadingFormat, date);
        } catch (e) {
             new Notice(`Weekly Notes: Error formatting weekly note heading: ${e.message}`, 5000);
             console.error("Weekly Notes: Error formatting weekly note heading", e);
             return "# Weekly Note";
        }
    }
}

class VaultInteractionService {
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
        return delimiter.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
            `^([\\s\\S]*?)(${this.escapeRegexForDelimiters(START)})\\n?([\\s\\S]*?)\\n?(${this.escapeRegexForDelimiters(END)})([\\s\\S]*)$`, "m"
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
                    await this.app.vault.modify(weeklyNoteFile, updatedContentWithHeading);
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
            await this.app.vault.modify(weeklyNoteFile, updatedFileContent);
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
            `^([\\s\\S]*?)(${this.escapeRegexForDelimiters(START)})\\n?([\\s\\S]*?)\\n?(${this.escapeRegexForDelimiters(END)})([\\s\\S]*)$`, "m"
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
            await this.app.vault.modify(noteFile, normalizedUpdatedContent);
            new Notice(`Weekly Notes: Removed link for "${dailyFileBasenameToRemove}" from "${weeklyNotePath}".`, 3000);
        }
    }
}

class WeeklyNotesSettingTabV2 extends PluginSettingTab {
    plugin: WeeklyNotesPluginV2;
    private previewElements: { [key: string]: HTMLElement } = {};

    constructor(app: App, plugin: WeeklyNotesPluginV2) {
        super(app, plugin);
        this.plugin = plugin;
    }
    
    private generatePreview(settingKey: 'weeklyNoteFolderPath' | 'weeklyNoteFilenameFormat' | 'weeklyNoteHeadingFormat') {
        const previewEl = this.previewElements[settingKey];
        if (!previewEl) return;

        const formatString = this.plugin.settings[settingKey];
        const sampleDate = moment(); 
        
        // Use toggleClass for safer style manipulation
        previewEl.toggleClass('weekly-notes-setting-preview-error', false);

        try {
            const previewText = formatDateWithCustomTokens(formatString, sampleDate);
            previewEl.setText(`Preview: ${previewText}`);
        } catch (e) {
            previewEl.setText(`Preview Error: Invalid format token. ${e.message}`);
            previewEl.toggleClass('weekly-notes-setting-preview-error', true);
        }
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();
        containerEl.createEl('h2', { text: 'Weekly Notes Linker Settings' });

        containerEl.createEl('h3', { text: 'Daily Note Identification' });
        new Setting(containerEl)
            .setName('Daily Note Date Format').setDesc('Moment.js format for parsing dates from daily notes.')
            .addText(text => text.setPlaceholder('YYYY-MM-DD').setValue(this.plugin.settings.dailyNoteFormat)
                .onChange(async (value) => { this.plugin.settings.dailyNoteFormat = value; await this.plugin.saveSettings(); }));
        new Setting(containerEl)
            .setName('Daily Note Filename Regex (Optional)').setDesc('JS Regex to identify daily notes and extract date. Must include named group: (?<dateString>...).')
            .addText(text => text.setPlaceholder('^Day-(?<dateString>YYYY-MM-DD)\\.md$').setValue(this.plugin.settings.dailyNoteFilenameRegex)
                .onChange(async (value) => { this.plugin.settings.dailyNoteFilenameRegex = value; await this.plugin.saveSettings(); }));
        
        containerEl.createEl('h3', { text: 'Weekly Note Configuration' });
        const weeklyFolderSetting = new Setting(containerEl)
            .setName('Weekly Notes Folder Path').setDesc('Path for weekly notes. Supports Moment.js tokens (e.g., {{GGGG}}/Weekly/). Ends with /.')
            .addText(text => text.setPlaceholder('{{GGGG}}/Weekly/').setValue(this.plugin.settings.weeklyNoteFolderPath)
                .onChange(async (value) => { this.plugin.settings.weeklyNoteFolderPath = normalizePath(value.endsWith('/') ? value : `${value}/`); await this.plugin.saveSettings(); this.generatePreview('weeklyNoteFolderPath'); }));
        this.previewElements['weeklyNoteFolderPath'] = weeklyFolderSetting.controlEl.createDiv({ cls: 'setting-item-description weekly-notes-setting-preview' }); this.generatePreview('weeklyNoteFolderPath');

        const weeklyFilenameSetting = new Setting(containerEl)
            .setName('Weekly Note Filename Format').setDesc('Filename for weekly notes. Supports Moment.js tokens.')
            .addText(text => text.setPlaceholder('{{GGGG}}-W{{WW}}.md').setValue(this.plugin.settings.weeklyNoteFilenameFormat)
                .onChange(async (value) => { this.plugin.settings.weeklyNoteFilenameFormat = value; await this.plugin.saveSettings(); this.generatePreview('weeklyNoteFilenameFormat'); }));
        this.previewElements['weeklyNoteFilenameFormat'] = weeklyFilenameSetting.controlEl.createDiv({ cls: 'setting-item-description weekly-notes-setting-preview' }); this.generatePreview('weeklyNoteFilenameFormat');

        const weeklyHeadingSetting = new Setting(containerEl)
            .setName('Weekly Note Heading Format').setDesc('Heading for new weekly notes. Supports Moment.js tokens and operations.')
            .addText(text => text.setPlaceholder('# Week {{W}} ({{MMM D}} to {{MMM D, add=6,days}})').setValue(this.plugin.settings.weeklyNoteHeadingFormat)
                .onChange(async (value) => { this.plugin.settings.weeklyNoteHeadingFormat = value; await this.plugin.saveSettings(); this.generatePreview('weeklyNoteHeadingFormat'); }));
        this.previewElements['weeklyNoteHeadingFormat'] = weeklyHeadingSetting.controlEl.createDiv({ cls: 'setting-item-description weekly-notes-setting-preview' }); this.generatePreview('weeklyNoteHeadingFormat');

        new Setting(containerEl)
            .setName('Daily Note Link Format').setDesc('Format for EACH daily note link line (e.g., "- ![[{{basename}}]]"). Newlines are added between links by the plugin.')
            .addText(text => text.setPlaceholder('- ![[{{basename}}]]').setValue(this.plugin.settings.weeklyNoteLinkFormat)
                .onChange(async (value) => { this.plugin.settings.weeklyNoteLinkFormat = value; await this.plugin.saveSettings(); }));
        
         new Setting(containerEl)
            .setName('Links Section Heading (Optional)').setDesc('If specified (e.g., "## Daily Notes"), links and delimiters will be placed under this heading if the block is created new.')
            .addText(text => text.setPlaceholder('## Daily Notes').setValue(this.plugin.settings.weeklyNoteLinksSectionHeading)
                .onChange(async (value) => { this.plugin.settings.weeklyNoteLinksSectionHeading = value; await this.plugin.saveSettings(); }));

        new Setting(containerEl)
            .setName('Start Delimiter for Links Block').setDesc('Marks the beginning of the auto-managed links section. REQUIRED for robust operation.')
            .addText(text => text.setPlaceholder(DEFAULT_SETTINGS.linksStartDelimiter).setValue(this.plugin.settings.linksStartDelimiter)
                .onChange(async (value) => { this.plugin.settings.linksStartDelimiter = value; await this.plugin.saveSettings(); }));
        
        new Setting(containerEl)
            .setName('End Delimiter for Links Block').setDesc('Marks the end of the auto-managed links section. REQUIRED for robust operation.')
            .addText(text => text.setPlaceholder(DEFAULT_SETTINGS.linksEndDelimiter).setValue(this.plugin.settings.linksEndDelimiter)
                .onChange(async (value) => { this.plugin.settings.linksEndDelimiter = value; await this.plugin.saveSettings(); }));

        new Setting(containerEl)
            .setName('Ensure Weekly Note Heading Exists').setDesc("Adds defined heading to existing weekly notes if missing (outside delimiters).")
            .addToggle(toggle => toggle.setValue(this.plugin.settings.ensureWeeklyNoteHeadingExists)
                .onChange(async (value) => { this.plugin.settings.ensureWeeklyNoteHeadingExists = value; await this.plugin.saveSettings(); }));

        containerEl.createEl('h3', { text: 'Behavior' });
        new Setting(containerEl).setName('Automatically Process on New Daily Note Creation')
            .addToggle(toggle => toggle.setValue(this.plugin.settings.autoProcessOnCreate)
                .onChange(async (value) => { this.plugin.settings.autoProcessOnCreate = value; await this.plugin.saveSettings(); }));
        new Setting(containerEl).setName('Automatically Process on Startup').setDesc("Runs a check/backfill on Obsidian startup.")
            .addToggle(toggle => toggle.setValue(this.plugin.settings.autoProcessOnStartup)
                .onChange(async (value) => { this.plugin.settings.autoProcessOnStartup = value; await this.plugin.saveSettings(); }));
        new Setting(containerEl).setName('Debounce Delay for Processing (ms)').setDesc('Delay after file events before processing.')
            .addText(text => text.setPlaceholder('1500').setValue(this.plugin.settings.debounceDelay.toString())
                .onChange(async (value) => { const n = parseInt(value); if (!isNaN(n) && n>=0) {this.plugin.settings.debounceDelay = n; await this.plugin.saveSettings();}}));
        
        containerEl.createEl('h3', { text: 'Manual Operations' });
        new Setting(containerEl).setName('Run Full Backfill on Next Startup').setDesc('Processes all existing daily notes next time Obsidian starts.')
            .addToggle(toggle => toggle.setValue(this.plugin.settings.runBackfillOnNextStartup)
                .onChange(async (value) => { this.plugin.settings.runBackfillOnNextStartup = value; await this.plugin.saveSettings(); }));
        
        containerEl.createEl('p', { text: 'Use commands for immediate backfill. Moment.js tokens are supported in formats.'});
        
        // --- FIX FOR innerHTML: Use safe DOM API ---
        const docsEl = containerEl.createEl('p');
        docsEl.appendText('Refer to ');
        docsEl.createEl('a', {
            text: 'Moment.js documentation',
            href: 'https://momentjs.com/docs/#/displaying/format/',
            attr: { 'target': '_blank', 'rel': 'noopener noreferrer' }
        });
        docsEl.appendText(' for all available format tokens.');
    }
}
