import {
    App,
    Plugin,
    TFile,
    Notice,
    debounce
} from 'obsidian';
import { WeeklyNotesSettings, DEFAULT_SETTINGS } from './src/types/settings';
import { DateLogicService } from './src/services/DateLogicService';
import { VaultInteractionService } from './src/services/VaultInteractionService';
import { WeeklyNotesSettingTabV2 } from './src/settings/WeeklyNotesSettingTabV2';

export default class WeeklyNotesPluginV2 extends Plugin {
    settings: WeeklyNotesSettings;
    private debouncedProcessDailyNote: (dailyFile: TFile) => void;
    private dateLogicService: DateLogicService;
    private vaultInteractionService: VaultInteractionService;

    async onload() {
        await this.loadSettings();

        this.dateLogicService = new DateLogicService(this.settings);
        this.vaultInteractionService = new VaultInteractionService(this.app, this.settings, this.dateLogicService);

        this.debouncedProcessDailyNote = debounce(
            (dailyFile: TFile) => { this.processDailyNote(dailyFile); },
            this.settings.debounceDelay, true
        );

        this.app.workspace.onLayoutReady(async () => {
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

    onunload() {}

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
