require("dotenv").config();
const express = require("express");
const cors = require("cors");
const Groq = require("groq-sdk");

const app = express();

app.use(cors());


app.use(express.json());

app.get("/health", (req, res) => {
  res.json({ ok: true, service: "ExamPilot" });
});

function cleanSyllabus(text) {
  return String(text || "")
    .replace(/\d+\s*of\s*\d+/gi, "")
    .replace(/[^\x20-\x7E\n]/g, "")
    .replace(/\n\s*\n/g, "\n")
    .trim()
    .substring(0, 6000);
}

function stripMarkdownFences(text) {
  return String(text || "")
    .replace(/^```[a-zA-Z]*\n?/, "")
    .replace(/\n```$/, "")
    .trim();
}
function getTodayInIST() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;

  return new Date(`${year}-${month}-${day}T00:00:00+05:30`);
}

function formatDateForPrompt(date) {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
}


const GROQ_KEYS = [
  process.env.GROQ_API_KEY_1,
  process.env.GROQ_API_KEY_2,
  process.env.GROQ_API_KEY_3,
  process.env.GROQ_API_KEY_4,
].filter(Boolean);

if (!GROQ_KEYS.length) {
  throw new Error("No GROQ API keys configured.");
}

let currentKeyIndex = 0;

function getGroqClient() {
  return new Groq({ apiKey: GROQ_KEYS[currentKeyIndex] });
}

function rotateKey() {
  currentKeyIndex = (currentKeyIndex + 1) % GROQ_KEYS.length;
}

async function groqChat(messages) {
  let attempts = 0;

  while (attempts < GROQ_KEYS.length) {
    try {
      const groq = getGroqClient();

      const chat = await groq.chat.completions.create({
        model: "llama-3.3-70b-versatile",
        max_tokens: 4000,
        temperature: 0.3,
        messages,
      });

      return chat.choices[0].message.content;
    } catch (error) {
      if (error.status === 429) {
        rotateKey();
        attempts += 1;
        continue;
      }

      throw error;
    }
  }

  throw new Error("All API keys are rate limited.");
}

function extractTodayPlan(plan) {
  const match = String(plan || "").match(
    /\*\*DAY 1[\s\S]*?(?=\*\*DAY 2|\*\*FINAL CHECKLIST|$)/i
  );

  return match ? match[0].trim() : String(plan || "").trim();
}


app.post("/study-plan", async (req, res) => {
  try {
    const { examType = "JEE", syllabus, examDate, hoursPerDay = 4 } = req.body;
    if (!syllabus || !examDate) {
      return res.status(400).json({
        success: false,
        error: "Missing syllabus or exam date",
      });
    }

    const today = getTodayInIST();
    const exam = new Date(`${examDate}T00:00:00+05:30`);


    if (Number.isNaN(exam.getTime())) {
      return res.status(400).json({
        success: false,
        error: "Invalid exam date",
      });
    }

    const daysLeft = Math.max(
      1,
      Math.ceil((exam - today) / (1000 * 60 * 60 * 24))
    );

    const planningDays = Math.min(daysLeft, 30);
    const cleanedSyllabus = cleanSyllabus(syllabus);
    const todayStr = formatDateForPrompt(today);


    const rawPlan = await groqChat([
  {
    role: "system",
    content:
      "You are ExamPilot, an expert Indian exam planner who creates realistic, premium-quality day-by-day study plans for Indian students.",
  },
  {
    role: "user",
    content: `Create a realistic ${daysLeft}-day study plan for a ${examType} student.

Today is ${todayStr}. DAY 1 must use the real weekday for this date, and each next day must follow the real calendar sequence.
Available study time: ${hoursPerDay} hours per day.

Rules:
- Use only the syllabus provided.
- Keep each day realistic and executable.
- Prioritize foundational topics first, then practice, then revision.
- Do not add motivational filler.
- Make Day 1 and Day 2 especially strong and clear.
- The plan should feel useful enough that a student would pay for full access.

Syllabus:
${cleanedSyllabus}

Format exactly like this:

**DAY 1 - [Day Name]**

**Morning (${Math.max(1, Math.floor(hoursPerDay / 2))} hrs):**
- [exact topic + exact task]
- [exact topic + exact task]

**Evening (${Math.max(1, Math.ceil(hoursPerDay / 2))} hrs):**
- [exact topic + exact task]
- [exact topic + exact task]

**Must Finish Today:**
- [clear completion target]
- [clear completion target]

**Practice:**
- [specific practice task]
- [specific practice task]
- [specific practice task]

**Revision Check:**
- [quick revision or self-test]
- [what to revisit if weak]

Repeat this exact format for all days.

End with:

**FINAL CHECKLIST**
- [highest priority revision block]
- [important practice block]
- [last-day focus]`,
  },
]);

    const plan = stripMarkdownFences(rawPlan);
    const todayPlan = extractTodayPlan(plan);

    return res.json({
      success: true,
      plan,
      todayPlan,
      daysLeft,
      planningDays,
    });
  } catch (error) {
    console.error("study-plan error:", error);

    return res.status(500).json({
      success: false,
      error: error.message || "Failed to generate study plan",
    });
  }
});

const PORT = process.env.PORT || 5001;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`ExamPilot backend running on ${PORT}`);
});
