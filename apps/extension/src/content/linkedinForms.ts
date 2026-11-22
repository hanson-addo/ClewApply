/** LinkedIn's profile edit forms, which open as dialogs on the profile page. */

import { byLabel, dates, longText, presentNote, type SiteForms } from "./forms";

export const LINKEDIN: SiteForms = {
  name: "LinkedIn",
  howToOpen: "press a pencil, or Add",
  covers: "your intro, about, experience and education",
  forms: [
    {
      kind: "intro",
      title: "Intro",
      heading: /^edit intro\b/i,
      section: "basics",
      parts: [
        { part: "headline", fill: byLabel("Headline") },
        {
          part: "location",
          fill: byLabel("City", "Location"),
          note: () => "Pick the matching place from LinkedIn's list under City.",
        },
      ],
    },
    {
      kind: "about",
      title: "About",
      heading: /^(add|edit) (about|summary)\b/i,
      section: "basics",
      parts: [{ part: "about", fill: longText("About", "Description", "Summary") }],
    },
    {
      kind: "position",
      title: "Experience",
      heading: /^(add|edit) (experience|position)\b/i,
      section: "work",
      parts: [
        { part: "title", fill: byLabel("Title") },
        {
          part: "company",
          fill: byLabel("Company name", "Company or organization", "Company"),
          note: () => "If LinkedIn suggests the company, pick it from the list.",
        },
        {
          part: "dates",
          fill: dates(["Start date"], ["End date"]),
          note: presentNote("LinkedIn", "I am currently working in this role"),
        },
      ],
    },
    {
      kind: "education",
      title: "Education",
      heading: /^(add|edit) education\b/i,
      section: "education",
      parts: [
        { part: "school", fill: byLabel("School"), note: () => "If LinkedIn suggests the school, pick it from the list." },
        { part: "degree", fill: byLabel("Degree") },
        { part: "field", fill: byLabel("Field of study") },
        { part: "dates", fill: dates(["Start date"], ["End date", "End date (or expected)"]) },
      ],
    },
  ],
};
