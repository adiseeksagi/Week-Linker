export interface WeeklyNotesSettings {
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

export const DEFAULT_SETTINGS: WeeklyNotesSettings = {
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