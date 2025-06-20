import { moment } from 'obsidian';

export function formatDateWithCustomTokens(formatString: string, date: moment.Moment): string {
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