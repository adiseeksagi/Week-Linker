# Week Linker
**Week Linker** is an Obsidian plugin that automatically links each daily note to its corresponding weekly note. This creates a centralized weekly summary page where all your daily entries are aggregated for easy end-of-week review.

The plugin was designed to streamline weekly reviews by providing a single location to view and reflect on all your work, tasks, and notes from the past seven days.
## Usage Instructions

Once installed and enabled, the plugin automatically links your daily note to its corresponding weekly note. Whenever you create or open a daily note, the plugin checks whether it belongs to a specific week (based on date) and then inserts a link to it in that week's note. This helps create a clean log of your week across different daily entries.

You don't have to do anything manually after setup—just use your daily and weekly notes as usual. On Sunday or any review day, you can open your weekly note and see all the linked daily notes listed in one place.

If the daily note is already linked, the plugin will avoid duplicating it. This helps keep the weekly note clean and prevents redundancy.

## Settings Explained

### Weekly Note Format

This defines the naming convention of your weekly notes. The plugin uses this format to detect or create the correct weekly note for any given day. For example, using `Week-{{year}}-{{week}}` will match notes like `Week-2025-20`.

It's recommended to use ISO week format (`{{year}}` and `{{week}}`) to ensure consistency, especially if you're using weekly reviews as a habit.

### Weekly Note Link Format

This sets how the daily note links are formatted when added to the weekly note. The default is 
`- ![[{{basename}}]]`, which adds each daily note as a bullet point. You can customize this depending on your personal style. For example, you might want to prefix with a date or status icon.

Keeping it simple and uniform helps with readability during reviews.

### Weekly Note Links Section Heading

If you prefer that the daily links appear under a specific heading (like `## Linked Days`), you can define that heading here. The plugin will then place all the daily links below that section. If this is left empty, links will simply be placed at the bottom of the weekly note.

This is useful if your weekly notes follow a certain structure or template, and you want the links to fit in cleanly.

### Ensure Weekly Note Heading Exists

When enabled, the plugin will automatically insert the heading you specified above if it doesn't already exist. This ensures that the section structure remains consistent, even if you create a new weekly note from scratch.

This saves time and avoids small formatting errors.

### Start Delimiter and End Delimiter

Delimiters are used to mark the exact section of the weekly note where daily links should be inserted. The plugin only updates the content between these two markers. This helps avoid overwriting unrelated content in your weekly note.

A common setup looks like this:

```
---start--- 
- ![[12-05-2025]] 
- ![[13-05-2025]] 
---end---
# i use --- as delimter
```
Make sure you don’t manually edit this section, as the plugin maintains it automatically. If you prefer more control or want to manually structure your weekly notes, you can disable this feature by leaving the delimiters blank, but that’s not recommended for most users.

#### Setting Screenshots
![Setting Screenshot 1](<Screenshots/Week Linker Settings SS 1.png>)
![Setting screenshot 2](<Screenshots/Week Linker Setting SS 2.png>)

## Use Cases (AI generated ideas)

This plugin is created to assist in regular weekly reviews and keeping track of your tasks. Here are some simple yet useful methods in which you can use it:

**1. Weekly To-Do Cleanup**  
As the week goes on, your work gets scattered throughout your daily notes. All of these day entries get automatically cross-referenced with the weekly note using this plugin. On Sunday, just open the weekly page and get an overview of your week—what got completed, what didn’t. Reviewing and tidying up remaining tasks becomes quick and efficient.

**2. Weekly Single-Point Reflection**  
If you perform weekly reviews, then the plugin becomes part of your routine. It aggregates your activity throughout the week into one page. Whether it's habits, journaling, or logging work, having all your day-to-day entries on one page makes weekly review much easier.

**3. Simplified Context Switching**  
Let's suppose you did some project work on Monday and then again on Thursday. If both of those days are associated with the weekly note, then you don't have to keep track of specific dates—you can just go open the weekly note and then move from there. It is something of a soft table of contents for your week.

**4. Habit Tracking & Planning**  
You can apply this structure to monitor how well and consistently you maintained some habits or routines during the week. If you spend time each day writing brief notes, it will present you with a visual picture of the week's rhythm.

**5. Long Term Logs Without the Clutter**  
These weekly notes gradually become high-level records of your life or work—helpful for month-end reviews or yearly retrospectives. And because linking is done automatically, it does not get in the way of your normal activities.

## How I use it
Here is a screenshot of my week page
![My Workflow](<Screenshots/Week linker My workflow.png>)
<br>
This is what a typical weekly note looks like for me. I log my daily work, habits, and projects as the week unfolds, and by Sunday I just open this one file to review, reflect, and clean up anything left undone. It saves me the trouble of chasing down individual notes, and gives me a calm overview before starting the next week.

You can use it your own way—some people use it for journaling, others for habit tracking or project logs. What matters is that everything is in one place when it’s time to review.

## Feedback and Contact
If you find Week Linker useful, I’d love to hear how you’re using it—and how it could be improved. Feature suggestions, bug reports, or even just a quick message that it helped you are always welcome.

If you're building something similar, or want to collaborate on productivity-focused Obsidian tools, feel free to reach out. I'm always open to exchanging ideas or working together.

You can contact me at:  
Email Address: adiseeksagi@gmail.com
<br>
[Instagram](https://www.instagram.com/adiseeksagi/?hl=en) (preferred)
<br>
[Github](https://github.com/adiseeksagi)

If this plugin helped streamline your workflow, consider leaving a review or star on the repo. It helps others discover it, and keeps the project going.
