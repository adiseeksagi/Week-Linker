import { PluginSettingTab, Setting, moment, normalizePath, Plugin } from 'obsidian';
import { formatDateWithCustomTokens } from '../utils/date';

export class WeeklyNotesSettingTabV2 extends PluginSettingTab {
    plugin: Plugin;
    private previewElements: { [key: string]: HTMLElement } = {};

    constructor(app: any, plugin: Plugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    private generatePreview(settingKey: 'weeklyNoteFolderPath' | 'weeklyNoteFilenameFormat' | 'weeklyNoteHeadingFormat') {
        const previewEl = this.previewElements[settingKey];
        if (!previewEl) return;

        const formatString = (this.plugin as any).settings[settingKey];
        const sampleDate = moment(); 
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

        new Setting(containerEl)
            .setName('Weekly notes')
            .setHeading();

        new Setting(containerEl)
            .setName('Daily note identification')
            .setHeading();
        new Setting(containerEl)
            .setName('Daily note date format').setDesc('Moment.js format for parsing dates from daily notes.')
            .addMomentFormat(fp => fp
                .setValue((this.plugin as any).settings.dailyNoteFormat)
                .onChange(async v => {
                    (this.plugin as any).settings.dailyNoteFormat = v;
                    await (this.plugin as any).saveSettings();
                }));
        new Setting(containerEl)
            .setName('Daily note filename regex (optional)').setDesc('JS regex to identify daily notes and extract date. Must include named group: (?<dateString>...).')
            .addText(text => text.setPlaceholder('^Day-(?<dateString>YYYY-MM-DD)\.md$').setValue((this.plugin as any).settings.dailyNoteFilenameRegex)
                .onChange(async (value) => { (this.plugin as any).settings.dailyNoteFilenameRegex = value; await (this.plugin as any).saveSettings(); }));

        new Setting(containerEl)
            .setName('Weekly notes')
            .setHeading();
        const weeklyFolderSetting = new Setting(containerEl)
            .setName('Weekly notes folder path').setDesc('Path for weekly notes. Supports Moment.js tokens (e.g., {{GGGG}}/Weekly/). Ends with /.')
            .addText(text => text.setPlaceholder('{{GGGG}}/Weekly/').setValue((this.plugin as any).settings.weeklyNoteFolderPath)
                .onChange(async (value) => { (this.plugin as any).settings.weeklyNoteFolderPath = normalizePath(value.endsWith('/') ? value : `${value}/`); await (this.plugin as any).saveSettings(); this.generatePreview('weeklyNoteFolderPath'); }));
        this.previewElements['weeklyNoteFolderPath'] = weeklyFolderSetting.controlEl.createDiv({ cls: 'setting-item-description weekly-notes-setting-preview' }); this.generatePreview('weeklyNoteFolderPath');

        const weeklyFilenameSetting = new Setting(containerEl)
            .setName('Weekly note filename format').setDesc('Filename for weekly notes. Supports Moment.js tokens.')
            .addMomentFormat(fp => fp
                .setValue((this.plugin as any).settings.weeklyNoteFilenameFormat)
                .onChange(async v => {
                    (this.plugin as any).settings.weeklyNoteFilenameFormat = v;
                    await (this.plugin as any).saveSettings();
                    this.generatePreview('weeklyNoteFilenameFormat');
                }));
        this.previewElements['weeklyNoteFilenameFormat'] = weeklyFilenameSetting.controlEl.createDiv({ cls: 'setting-item-description weekly-notes-setting-preview' }); this.generatePreview('weeklyNoteFilenameFormat');

        const weeklyHeadingSetting = new Setting(containerEl)
            .setName('Weekly note heading format').setDesc('Heading for new weekly notes. Supports Moment.js tokens and operations.')
            .addMomentFormat(fp => fp
                .setValue((this.plugin as any).settings.weeklyNoteHeadingFormat)
                .onChange(async v => {
                    (this.plugin as any).settings.weeklyNoteHeadingFormat = v;
                    await (this.plugin as any).saveSettings();
                    this.generatePreview('weeklyNoteHeadingFormat');
                }));
        this.previewElements['weeklyNoteHeadingFormat'] = weeklyHeadingSetting.controlEl.createDiv({ cls: 'setting-item-description weekly-notes-setting-preview' }); this.generatePreview('weeklyNoteHeadingFormat');

        new Setting(containerEl)
            .setName('Daily note link format').setDesc('Format for each daily note link line (e.g., "- ![[{{basename}}]]"). Newlines are added between links by the plugin.')
            .addText(text => text.setPlaceholder('- ![[{{basename}}]]').setValue((this.plugin as any).settings.weeklyNoteLinkFormat)
                .onChange(async (value) => { (this.plugin as any).settings.weeklyNoteLinkFormat = value; await (this.plugin as any).saveSettings(); }));
        new Setting(containerEl)
            .setName('Links section heading (optional)').setDesc('If specified (e.g., "## Daily notes"), links and delimiters will be placed under this heading if the block is created new.')
            .addText(text => text.setPlaceholder('## Daily notes').setValue((this.plugin as any).settings.weeklyNoteLinksSectionHeading)
                .onChange(async (value) => { (this.plugin as any).settings.weeklyNoteLinksSectionHeading = value; await (this.plugin as any).saveSettings(); }));
        new Setting(containerEl)
            .setName('Start delimiter for links block').setDesc('Marks the beginning of the auto-managed links section. Required for robust operation.')
            .addText(text => text.setPlaceholder('<!-- DAILY LINKS START -->').setValue((this.plugin as any).settings.linksStartDelimiter)
                .onChange(async (value) => { (this.plugin as any).settings.linksStartDelimiter = value; await (this.plugin as any).saveSettings(); }));
        new Setting(containerEl)
            .setName('End delimiter for links block').setDesc('Marks the end of the auto-managed links section. Required for robust operation.')
            .addText(text => text.setPlaceholder('<!-- DAILY LINKS END -->').setValue((this.plugin as any).settings.linksEndDelimiter)
                .onChange(async (value) => { (this.plugin as any).settings.linksEndDelimiter = value; await (this.plugin as any).saveSettings(); }));
        new Setting(containerEl)
            .setName('Ensure weekly note heading exists').setDesc('Adds defined heading to existing weekly notes if missing (outside delimiters).')
            .addToggle(toggle => toggle.setValue((this.plugin as any).settings.ensureWeeklyNoteHeadingExists)
                .onChange(async (value) => { (this.plugin as any).settings.ensureWeeklyNoteHeadingExists = value; await (this.plugin as any).saveSettings(); }));

        new Setting(containerEl)
            .setName('Behavior')
            .setHeading();
        new Setting(containerEl).setName('Automatically process on new daily note creation')
            .addToggle(toggle => toggle.setValue((this.plugin as any).settings.autoProcessOnCreate)
                .onChange(async (value) => { (this.plugin as any).settings.autoProcessOnCreate = value; await (this.plugin as any).saveSettings(); }));
        new Setting(containerEl).setName('Automatically process on startup').setDesc('Runs a check/backfill on Obsidian startup.')
            .addToggle(toggle => toggle.setValue((this.plugin as any).settings.autoProcessOnStartup)
                .onChange(async (value) => { (this.plugin as any).settings.autoProcessOnStartup = value; await (this.plugin as any).saveSettings(); }));
        new Setting(containerEl).setName('Debounce delay for processing (ms)').setDesc('Delay after file events before processing.')
            .addText(text => text.setPlaceholder('1500').setValue((this.plugin as any).settings.debounceDelay.toString())
                .onChange(async (value) => { const n = parseInt(value); if (!isNaN(n) && n>=0) {(this.plugin as any).settings.debounceDelay = n; await (this.plugin as any).saveSettings();}}));

        new Setting(containerEl)
            .setName('Manual operations')
            .setHeading();
        new Setting(containerEl).setName('Run full backfill on next startup').setDesc('Processes all existing daily notes next time Obsidian starts.')
            .addToggle(toggle => toggle.setValue((this.plugin as any).settings.runBackfillOnNextStartup)
                .onChange(async (value) => { (this.plugin as any).settings.runBackfillOnNextStartup = value; await (this.plugin as any).saveSettings(); }));

        containerEl.createEl('p', { text: 'Use commands for immediate backfill. Moment.js tokens are supported in formats.'});
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