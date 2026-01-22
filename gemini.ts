
import { GoogleGenAI } from "@google/genai";
import { StudyAnalysis } from "./types";

// Initialize Gemini client
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const SYSTEM_PROMPT = `You are a world-class Biblical scholar providing educational, non-dogmatic insights for personal Bible study. Focus on historical context, linguistic precision, and practical wisdom.

You MUST return your response as valid JSON matching this exact structure (no markdown, no code blocks, just raw JSON):
{
  "reference": "the passage reference",
  "translation": "the translation used",
  "summary": "a comprehensive summary of the passage",
  "context": {
    "author": "who wrote this book",
    "audience": "who was it written to",
    "setting": "historical and geographical setting",
    "purpose": "why was this written"
  },
  "keyThemes": ["theme1", "theme2", "theme3"],
  "languageInsights": [
    {
      "term": "original word",
      "language": "Hebrew or Greek",
      "transliteration": "how it's pronounced",
      "strongs": "Strong's number if applicable",
      "meaning": "what it means",
      "whyItMatters": "significance for interpretation"
    }
  ],
  "crossReferences": [
    {
      "reference": "Book chapter:verse",
      "connection": "how it relates to the main passage"
    }
  ],
  "keyLessons": ["lesson1", "lesson2", "lesson3"],
  "application": ["practical application 1", "practical application 2"],
  "prayer": "a prayer based on the passage"
}`;

export async function generateStudy(reference: string, translation: string = "KJV"): Promise<StudyAnalysis> {
  const prompt = `${SYSTEM_PROMPT}

Analyze the Bible passage ${reference} using the ${translation} translation.
Provide a deep, scholarly, yet accessible analysis.
Present historical and cultural context carefully.
Treat original language notes responsibly, acknowledging where scholars might differ.
Ensure the tone is respectful and educational.

Return ONLY valid JSON as specified above.`;

  const response = await ai.models.generateContent({
    model: "gemini-2.0-flash",
    contents: prompt,
  });

  try {
    const text = response.text || "{}";
    // Clean up any potential markdown code blocks
    const cleanedText = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    return JSON.parse(cleanedText) as StudyAnalysis;
  } catch (error) {
    console.error("Failed to parse Gemini response:", error);
    console.error("Raw response:", response.text);
    throw new Error("Could not parse study analysis. Please try again.");
  }
}

export async function chatWithPassage(passage: string, history: { role: string, parts: { text: string }[] }[], question: string) {
  const chat = ai.chats.create({
    model: "gemini-2.0-flash",
    history: history.map(h => ({
      role: h.role as "user" | "model",
      parts: h.parts
    })),
    config: {
      systemInstruction: `You are a helpful Biblical study assistant scoped to the passage: ${passage}. Answer questions thoughtfully and with scholarly depth.`
    }
  });

  const response = await (await chat).sendMessage({
    message: `Regarding ${passage}: ${question}`
  });

  return response.text || "I couldn't generate a response. Please try again.";
}
