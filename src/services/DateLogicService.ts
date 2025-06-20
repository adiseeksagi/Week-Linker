import { WeeklyNotesSettings } from '../types/settings';
import { formatDateWithCustomTokens } from '../utils/date';
import { TFile, Notice, normalizePath } from 'obsidian';
import moment from 'moment';

export class DateLogicService {
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
                new Notice(`Weekly Notes: Invalid daily note filename regex: ${e.message}`, 0);
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