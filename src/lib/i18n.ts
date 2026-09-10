// Fixed UI chrome for the patient-language layer — button labels,
// headers, and static explanatory text that isn't itself clinical
// content. Clinical question/answer wording is NOT here — that comes
// from the Clinical Configuration Layer's translation tables
// (question_translations / answer_option_translations), reviewed and
// approved the same way as clinical content. This file only covers the
// small set of app chrome strings around that content.

import type { Lang } from "./clinicalHistory";

type Dict = Record<string, string>;

const EN: Dict = {
  chooseLanguageTitle: "Choose your language",
  chooseLanguageSubtitle: "You can answer in whichever language is easier for you.",
  english: "English",
  romanUrdu: "Roman Urdu",
  beforeWeStart: "Before we start",
  iUnderstandAndAgree: "I understand and agree",
  saving: "Saving…",
  howShareHistory: "How would you like to share your history?",
  bothOptionsEqual: "Both options work equally well; pick whichever is easier.",
  answerFewQuestions: "Answer a few questions",
  answerFewQuestionsDesc: "A short set of multiple-choice questions about your complaint.",
  recordVoiceNote: "Record a voice note instead",
  recordVoiceNoteDesc: "Describe what's going on in your own words.",
  voiceNoteTitle: "Voice note",
  voiceNoteNotBuilt:
    "Voice-note recording isn't built yet in this phase. You can use the guided questions instead for now, or your doctor will follow up with you directly.",
  useGuidedInstead: "Use guided questions instead",
  switching: "Switching…",
  pleaseReadThis: "Please read this",
  emergencyFollowup:
    "If you think this is a medical emergency, do not wait — seek immediate emergency care or contact your local emergency service now. Your doctor has also been notified to review this consultation as a priority.",
  continue: "Continue",
  historySubmitted: "history submitted",
  flaggedNotice: "One or more answers were flagged for your doctor's prompt attention.",
  thanksRecorded:
    "Thanks — this history has been recorded and is attached to the consultation for your doctor to review.",
  backToDashboard: "Back to dashboard",
  forLabel: "For",
  history: "history",
  genericFlagFallback: "Your answer suggests this needs prompt attention.",
  urgentCareHeading: "Please read this now",
  emergencyContentNotReady:
    "This complaint's emergency guidance isn't ready yet, so this can't be shown. Your booking is still recorded — your doctor will follow up with you directly.",
  allSet: "You're all set",
  doctorNotifiedPriority:
    "Your doctor has been notified to follow up with you as a priority.",
};

const UR_ROMAN: Dict = {
  chooseLanguageTitle: "Apni zaban chunain",
  chooseLanguageSubtitle: "Aap jis zaban mein aasani mehsoos karein, usi mein jawab de sakte hain.",
  english: "English",
  romanUrdu: "Roman Urdu",
  beforeWeStart: "Shuru karne se pehle",
  iUnderstandAndAgree: "Mujhe samajh agaya, main razi hoon",
  saving: "Save ho raha hai…",
  howShareHistory: "Aap apni history kaise batana chahenge?",
  bothOptionsEqual: "Dono tareeqay aik jaisay theek hain; jo aasan lagay wohi chunain.",
  answerFewQuestions: "Chand sawalat ka jawab dein",
  answerFewQuestionsDesc: "Aapki takleef ke baray mein chand mukhtasar sawalat.",
  recordVoiceNote: "Iske bajaye voice note record karein",
  recordVoiceNoteDesc: "Apne alfaaz mein bataen ke kya ho raha hai.",
  voiceNoteTitle: "Voice note",
  voiceNoteNotBuilt:
    "Voice note record karne ki suvidha abhi tak taiyar nahi hai. Aap iske bajaye guided sawalat istemal kar sakte hain, ya aapka doctor khud aapse rabta karega.",
  useGuidedInstead: "Iske bajaye guided sawalat istemal karein",
  switching: "Tabdeel ho raha hai…",
  pleaseReadThis: "Yeh zaroor parhein",
  emergencyFollowup:
    "Agar aapko lagta hai ke yeh ek medical emergency hai, to intezaar na karein — foran emergency medical madad lein ya apni local emergency service se rabta karein. Aapke doctor ko bhi is consultation ko foran dekhne ke liye agah kar diya gaya hai.",
  continue: "Aagay barhein",
  historySubmitted: "history jama ho gayi",
  flaggedNotice:
    "Aik ya zyada jawabat aapke doctor ki foran tawajjo ke liye nishan zad kiye gaye hain.",
  thanksRecorded:
    "Shukriya — yeh history record ho gayi hai aur consultation ke saath mehfooz hai taake aapka doctor ise dekh sake.",
  backToDashboard: "Dashboard par wapas jayein",
  forLabel: "Baraye",
  history: "history",
  genericFlagFallback: "Aapka jawab zahir karta hai ke foran tawajjo zaroori hai.",
  urgentCareHeading: "Yeh abhi zaroor parhein",
  emergencyContentNotReady:
    "Is shikayat ke liye emergency guidance abhi taiyar nahi hai, is liye yeh dikhaya nahi ja sakta. Aapki booking mehfooz hai — aapka doctor khud aapse rabta karega.",
  allSet: "Aap ka kaam ho gaya",
  doctorNotifiedPriority:
    "Aapke doctor ko foran (priority) rabta karne ke liye agah kar diya gaya hai.",
};

const DICTS: Record<Lang, Dict> = { en: EN, "ur-roman": UR_ROMAN };

export function t(key: keyof typeof EN, lang: Lang): string {
  return DICTS[lang][key] ?? EN[key];
}

export function questionOfLabel(lang: Lang, n: number, total: number): string {
  return lang === "en" ? `question ${n} of ${total}` : `sawal ${n} baraye ${total}`;
}
