/*
 * FocusCheck — assessment content
 *
 * The 18 items below are the WHO Adult ADHD Self-Report Scale (ASRS-v1.1)
 * symptom checklist. Items 1-6 form Part A, the validated 6-question screener.
 *
 * Domain tags are used only to build the free summary bars:
 *   "inattention"          -> inattentive symptoms (9 items)
 *   "hyperactive"          -> hyperactivity / impulsivity symptoms (9 items)
 */
const SCALE = [
  { label: "Never",      value: 0 },
  { label: "Rarely",     value: 1 },
  { label: "Sometimes",  value: 2 },
  { label: "Often",      value: 3 },
  { label: "Very Often", value: 4 }
];

const QUESTIONS = [
  // ---- Part A: screener (6 items) ----
  { id: 1,  part: "A", domain: "inattention",
    text: "How often do you have trouble wrapping up the final details of a project, once the challenging parts have been done?" },
  { id: 2,  part: "A", domain: "inattention",
    text: "How often do you have difficulty getting things in order when you have to do a task that requires organization?" },
  { id: 3,  part: "A", domain: "inattention",
    text: "How often do you have problems remembering appointments or obligations?" },
  { id: 4,  part: "A", domain: "inattention",
    text: "When you have a task that requires a lot of thought, how often do you avoid or delay getting started?" },
  { id: 5,  part: "A", domain: "hyperactive",
    text: "How often do you fidget or squirm with your hands or feet when you have to sit down for a long time?" },
  { id: 6,  part: "A", domain: "hyperactive",
    text: "How often do you feel overly active and compelled to do things, like you were driven by a motor?" },

  // ---- Part B: additional symptoms (12 items) ----
  { id: 7,  part: "B", domain: "inattention",
    text: "How often do you make careless mistakes when you have to work on a boring or difficult project?" },
  { id: 8,  part: "B", domain: "inattention",
    text: "How often do you have difficulty keeping your attention when you are doing boring or repetitive work?" },
  { id: 9,  part: "B", domain: "inattention",
    text: "How often do you have difficulty concentrating on what people say to you, even when they are speaking to you directly?" },
  { id: 10, part: "B", domain: "inattention",
    text: "How often do you misplace or have difficulty finding things at home or at work?" },
  { id: 11, part: "B", domain: "inattention",
    text: "How often are you distracted by activity or noise around you?" },
  { id: 12, part: "B", domain: "hyperactive",
    text: "How often do you leave your seat in meetings or other situations in which you are expected to remain seated?" },
  { id: 13, part: "B", domain: "hyperactive",
    text: "How often do you feel restless or fidgety?" },
  { id: 14, part: "B", domain: "hyperactive",
    text: "How often do you have difficulty unwinding and relaxing when you have time to yourself?" },
  { id: 15, part: "B", domain: "hyperactive",
    text: "How often do you find yourself talking too much when you are in social situations?" },
  { id: 16, part: "B", domain: "hyperactive",
    text: "When you're in a conversation, how often do you find yourself finishing the sentences of the people you are talking to, before they can finish them themselves?" },
  { id: 17, part: "B", domain: "hyperactive",
    text: "How often do you have difficulty waiting your turn in situations when turn taking is required?" },
  { id: 18, part: "B", domain: "hyperactive",
    text: "How often do you interrupt others when they are busy?" }
];

/*
 * Part A scoring rules (per the ASRS-v1.1 screener instructions).
 * A response counts as "positive" when it lands in a shaded box:
 *   items 1-3 -> Sometimes (2) or above
 *   items 4-6 -> Often (3) or above
 * Four or more positive items out of six is the validated threshold.
 */
const SCREENER_RULES = {
  1: 2,  // Sometimes and above
  2: 2,
  3: 2,
  4: 3,  // Often and above
  5: 3,
  6: 3
};
const SCREENER_THRESHOLD = 4;
