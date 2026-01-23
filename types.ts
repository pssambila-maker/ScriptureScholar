
export interface StudyContext {
  author: string;
  audience: string;
  setting: string;
  purpose: string;
}

export interface LanguageInsight {
  term: string;
  language: 'Greek' | 'Hebrew' | 'Aramaic';
  transliteration: string;
  strongs?: string;
  meaning: string;
  whyItMatters: string;
}

export interface CrossReference {
  reference: string;
  connection: string;
}

export interface StudyAnalysis {
  reference: string;
  translation: string;
  scriptureText: string;
  summary: string;
  context: StudyContext;
  keyThemes: string[];
  languageInsights: LanguageInsight[];
  crossReferences: CrossReference[];
  keyLessons: string[];
  application: string[];
  prayer?: string;
}

export interface SavedStudy {
  id?: string;
  userId: string;
  reference: string;
  translation: string;
  createdAt: number;
  modelMetadata: {
    name: string;
    version: string;
  };
  analysis: StudyAnalysis;
  userNotes: string;
  tags: string[];
}

export interface ChatMessage {
  role: 'user' | 'model';
  text: string;
}
