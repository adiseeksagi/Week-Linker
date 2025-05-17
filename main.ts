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
    weeklyNoteLinkFormat: "- ![[{{basename}}]]", // NO leading \n here
    ensureWeeklyNoteHeadingExists: true,
    autoProcessOnCreate: true,
    autoProcessOnStartup: false,
    debounceDelay: 1500,
    runBackfillOnNextStartup: false,
    weeklyNoteLinksSectionHeading: "## Daily Notes", // Default to a section heading
    linksStartDelimiter: "",
    linksEndDelimiter: "",
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
        console.log('Loading Weekly Notes Plugin (Robust Delimited Blocks)');

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
            id: 'force-backfill-weekly-notes-robust-delimited',
            name: 'Backfill all daily notes to weekly notes (Robust Delimited)',
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
            id: 'process-current-daily-note-to-weekly-robust-delimited',
            name: "Process current daily note for weekly linking (Robust Delimited)",
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
        console.log('Unloading Weekly Notes Plugin (Robust Delimited Blocks)');
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
    // Regex to find daily note links, capturing the basename.
    // Adjusted to be less strict about line start/end within the block for extraction.
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
            return false; // Cannot operate without delimiters for this robust logic
        }

        // --- Ensure Folder & File Path Validity ---
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

        // --- Read or Create Weekly Note ---
        let rawContent = "";
        const mainHeadingText = this.dateLogicService.getWeeklyNoteHeading(dailyNoteDate);
        let mainHeadingPresentInOriginal = false;

        if (!weeklyNoteFile) {
            rawContent = mainHeadingText + "\n";
            if (this.settings.weeklyNoteLinksSectionHeading) {
                rawContent += "\n" + this.settings.weeklyNoteLinksSectionHeading + "\n";
            }
            rawContent += "\n" + START + "\n" + END + "\n"; // Add empty delimited block
            weeklyNoteFile = await this.app.vault.create(weeklyNotePath, rawContent);
            new Notice(`Weekly Notes: Created "${weeklyNotePath}".`, 3000);
            mainHeadingPresentInOriginal = true; // It was just added
        } else if (weeklyNoteFile instanceof TFile) {
            rawContent = await this.app.vault.cachedRead(weeklyNoteFile);
            mainHeadingPresentInOriginal = rawContent.includes(mainHeadingText.trim().split('\n')[0]);
        } else {
            console.error("Weekly Notes: Could not get or create weekly note file:", weeklyNotePath); return false;
        }
        if (!(weeklyNoteFile instanceof TFile)) return false;

        // --- Locate Delimited Block ---
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
            // content of START delimiter itself is match[2]
            currentLinksBlockContent = match[3];
            // content of END delimiter itself is match[4]
            contentAfterBlock = match[5];
        } else {
            // No delimiters found: we'll need to insert the block.
            // The "before" content will be determined by where we insert.
            // For now, assume we might insert it after a section heading or main heading.
        }

        // --- Parse Existing Links from the Block ---
        const existingBasenamesMap = new Map<string, moment.Moment>();
        if (hasBlock) {
            let linkMatch;
            this.dailyLinkExtractionRegex.lastIndex = 0; // Reset regex state for global regex
            while ((linkMatch = this.dailyLinkExtractionRegex.exec(currentLinksBlockContent)) !== null) {
                const basename = linkMatch[1]; // Capture group 1 is the basename
                const date = this.dateLogicService.getDailyNoteDateFromPath(basename, basename); // Try to parse date
                if (date) {
                    existingBasenamesMap.set(basename, date);
                } else {
                    existingBasenamesMap.set(basename, moment(0)); // Fallback for unparsable for sorting
                    console.warn(`Weekly Notes: Could not parse date for sorting from existing link: ${basename} in ${weeklyNotePath}`);
                }
            }
        }
        
        // --- If Already Linked (and no other changes needed to the block like sorting), Bail Out ---
        // This check is now more nuanced: if the link exists AND the block is already perfectly sorted AND formatted,
        // then we might bail. For simplicity of this refactor, we'll rebuild if the new link isn't there,
        // or if it is there but the overall block might need re-sorting/re-formatting.
        // The critical check is if the *new* link is already present.
        const newLinkAlreadyExists = existingBasenamesMap.has(dailyFileBasename);

        // Add the new link to the map (or update its date if it somehow existed with a different one)
        existingBasenamesMap.set(dailyFileBasename, dailyNoteDate);

        // --- Sort All Links by Date ---
        const sortedBasenames = Array.from(existingBasenamesMap.entries())
            .sort(([, dateA], [, dateB]) => dateA.valueOf() - dateB.valueOf())
            .map(([basename]) => basename);

        // --- Rebuild the Block Text ---
        const newLinksBlockLines = sortedBasenames.map(basename => {
            // Use the date associated with this specific basename for context if needed in link format
            const dateForThisLink = existingBasenamesMap.get(basename) || dailyNoteDate; // Should always find in map
            let linkLine = this.settings.weeklyNoteLinkFormat.replace(/\{\{basename\}\}/g, basename);
            return formatDateWithCustomTokens(linkLine, dateForThisLink);
        });
        const newLinksBlockText = newLinksBlockLines.join('\n');

        // --- If the new link was already there AND the block content hasn't changed by sorting, no need to write ---
        if (newLinkAlreadyExists && hasBlock && currentLinksBlockContent.trim() === newLinksBlockText.trim()) {
            // console.log(`Weekly Notes: Link for ${dailyFileBasename} already exists and block is sorted/formatted in ${weeklyNotePath}.`);
            // Check if main heading needs to be added, even if links are fine
            if (this.settings.ensureWeeklyNoteHeadingExists && !mainHeadingPresentInOriginal) {
                 const updatedContentWithHeading = mainHeadingText + "\n" + rawContent;
                 if (rawContent.trim() !== updatedContentWithHeading.trim()){
                    await this.app.vault.modify(weeklyNoteFile, updatedContentWithHeading);
                    return true; // File was modified for heading
                 }
            }
            return false; // No changes needed
        }


        // --- Reassemble File Content ---
        let updatedFileContent: string;

        // Ensure main heading is present if configured
        let finalContentBeforeBlock = hasBlock ? contentBeforeBlock : rawContent;
        if (this.settings.ensureWeeklyNoteHeadingExists && !mainHeadingPresentInOriginal) {
            // If adding heading to a file that had a block, need to be careful
            if (hasBlock) {
                // This case is complex: heading missing but block exists.
                // Simplest: prepend heading to `contentBeforeBlock`
                finalContentBeforeBlock = mainHeadingText + "\n" + contentBeforeBlock;
            } else {
                // No block, just prepend heading to whatever rawContent was
                finalContentBeforeBlock = mainHeadingText + "\n" + rawContent;
            }
        }


        if (hasBlock) {
            updatedFileContent = finalContentBeforeBlock + // Already includes content before START
                               START + '\n' +
                               newLinksBlockText + 
                               (newLinksBlockText.length > 0 ? '\n' : '') + // Add newline if block has content
                               END +
                               contentAfterBlock;
        } else {
            // Delimiters were not found, insert them and the new links block.
            let insertionPoint = -1;
            let contentToInsertInto = finalContentBeforeBlock; // Start with potentially heading-adjusted content

            if (this.settings.weeklyNoteLinksSectionHeading) {
                const sectionHeadingRegex = new RegExp(`^${escapeRegExp(this.settings.weeklyNoteLinksSectionHeading.trim())}(\r?\n|$)`, "m");
                const sectionMatch = sectionHeadingRegex.exec(contentToInsertInto);
                if (sectionMatch) {
                    insertionPoint = sectionMatch.index + sectionMatch[0].length; // After the section heading line
                } else {
                    // Section heading not found, append it, then the delimiters and block
                    contentToInsertInto += (contentToInsertInto.endsWith('\n') ? '' : '\n') + 
                                           (contentToInsertInto.trim() === "" ? "" : "\n") + // Add extra newline if content exists
                                           this.settings.weeklyNoteLinksSectionHeading + '\n';
                    insertionPoint = contentToInsertInto.length; // End of the newly added heading
                }
            } else if (mainHeadingPresentInOriginal || (this.settings.ensureWeeklyNoteHeadingExists && !mainHeadingPresentInOriginal)) {
                 // Insert after the main heading if no specific section heading
                 const firstLineEnd = contentToInsertInto.indexOf('\n');
                 if (firstLineEnd !== -1) {
                    insertionPoint = firstLineEnd + 1; // After the first line (main heading)
                 } else {
                    insertionPoint = contentToInsertInto.length; // Append if only one line (main heading only)
                 }
            } else {
                insertionPoint = contentToInsertInto.length; // Fallback: append to end of whatever content is there
            }
            
            const blockToInsert = (insertionPoint > 0 && !contentToInsertInto.substring(0, insertionPoint).endsWith('\n\n') && !contentToInsertInto.substring(0, insertionPoint).endsWith('\n') ? '\n' : '') + // Ensure separation
                                 START + '\n' +
                                 newLinksBlockText +
                                 (newLinksBlockText.length > 0 ? '\n' : '') +
                                 END + '\n';

            updatedFileContent = contentToInsertInto.substring(0, insertionPoint) +
                                 blockToInsert +
                                 contentToInsertInto.substring(insertionPoint);
        }
        
        updatedFileContent = updatedFileContent.replace(/\r\n/g, '\n').trimEnd() + '\n'; // Normalize and ensure trailing newline
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

        if (!match) {
            // console.log(`Weekly Notes: Delimiters not found in ${weeklyNotePath}. Cannot remove link precisely.`);
            // Optionally, could fall back to a more naive global search and replace, but this is risky.
            // For now, if delimiters aren't found, we don't touch the file for removal.
            return;
        }

        const contentBeforeBlock = match[1];
        const currentLinksBlockContent = match[3];
        const contentAfterBlock = match[5];
        
        const existingBasenamesMap = new Map<string, moment.Moment>();
        let linkMatch;
        this.dailyLinkExtractionRegex.lastIndex = 0; 
        while ((linkMatch = this.dailyLinkExtractionRegex.exec(currentLinksBlockContent)) !== null) {
            const basename = linkMatch[1];
            if (basename !== dailyFileBasenameToRemove) { // Exclude the one to remove
                const date = this.dateLogicService.getDailyNoteDateFromPath(basename, basename);
                if (date) existingBasenamesMap.set(basename, date);
                else existingBasenamesMap.set(basename, moment(0));
            }
        }

        // Check if any link was actually removed by comparing sizes
        const initialLinkCountInBlock = (currentLinksBlockContent.match(this.dailyLinkExtractionRegex) || []).length;
        if (existingBasenamesMap.size === initialLinkCountInBlock && initialLinkCountInBlock > 0) {
            // console.log(`Weekly Notes: Link for ${dailyFileBasenameToRemove} not found within delimited block of ${weeklyNotePath}.`);
            return; // No change needed
        }
        
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
        if (!this.previewElements[settingKey]) return;
        const formatString = this.plugin.settings[settingKey];
        const sampleDate = moment(); 
        try {
            const previewText = formatDateWithCustomTokens(formatString, sampleDate);
            this.previewElements[settingKey].setText(`Preview: ${previewText}`);
            this.previewElements[settingKey].style.color = 'var(--text-normal)';
        } catch (e) {
            this.previewElements[settingKey].setText(`Preview Error: Invalid format. ${e.message}`);
            this.previewElements[settingKey].style.color = 'var(--text-error)';
        }
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();
        containerEl.createEl('h2', { text: 'Week Linker Settings' });

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
        this.previewElements['weeklyNoteFolderPath'] = weeklyFolderSetting.controlEl.createDiv({ cls: 'setting-item-description setting-item-preview' }); this.generatePreview('weeklyNoteFolderPath');

        const weeklyFilenameSetting = new Setting(containerEl)
            .setName('Weekly Note Filename Format').setDesc('Filename for weekly notes. Supports Moment.js tokens.')
            .addText(text => text.setPlaceholder('{{GGGG}}-W{{WW}}.md').setValue(this.plugin.settings.weeklyNoteFilenameFormat)
                .onChange(async (value) => { this.plugin.settings.weeklyNoteFilenameFormat = value; await this.plugin.saveSettings(); this.generatePreview('weeklyNoteFilenameFormat'); }));
        this.previewElements['weeklyNoteFilenameFormat'] = weeklyFilenameSetting.controlEl.createDiv({ cls: 'setting-item-description setting-item-preview' }); this.generatePreview('weeklyNoteFilenameFormat');

        const weeklyHeadingSetting = new Setting(containerEl)
            .setName('Weekly Note Heading Format').setDesc('Heading for new weekly notes. Supports Moment.js tokens and operations.')
            .addText(text => text.setPlaceholder('# Week {{W}} ({{MMM D}} to {{MMM D, add=6,days}})').setValue(this.plugin.settings.weeklyNoteHeadingFormat)
                .onChange(async (value) => { this.plugin.settings.weeklyNoteHeadingFormat = value; await this.plugin.saveSettings(); this.generatePreview('weeklyNoteHeadingFormat'); }));
        this.previewElements['weeklyNoteHeadingFormat'] = weeklyHeadingSetting.controlEl.createDiv({ cls: 'setting-item-description setting-item-preview' }); this.generatePreview('weeklyNoteHeadingFormat');

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
        containerEl.createEl('p').innerHTML = 'Refer to <a href="https://momentjs.com/docs/#/displaying/format/" target="_blank">Moment.js documentation</a> for tokens.';
    }
}
