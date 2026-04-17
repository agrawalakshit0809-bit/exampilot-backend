require("dotenv").config();
const express = require("express");
const cors = require("cors");
const Groq = require("groq-sdk");

const app = express();

const allowedOrigins = [
  process.env.FRONTEND_URL,
  process.env.FRONTEND_PREVIEW_URL,
].filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      return callback(new Error("Not allowed by CORS"));
    },
  })
);

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
    /\*\*DAY 1[\s\S]*?(?=\*\*DAY 2|\*\*FINAL|$)/i
  );

  return match ? match[0].trim() : String(plan || "").trim();
}

app.post("/study-plan", async (req, res) => {
  try {
    const {
      examType = "JEE",
      syllabus,
      examDate,
      hoursPerDay = 4,
    } = req.body;

    if (!syllabus || !examDate) {
      return res.status(400).json({
        success: false,
        error: "Missing syllabus or exam date",
      });
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const exam = new Date(`${examDate}T00:00:00`);

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
    const todayStr = today.toDateString();

    const rawPlan = await groqChat([
      {
        role: "system",
        content:
          "You are ExamPilot, an expert Indian exam planner who creates practical day-by-day study plans.",
      },
      {
        role: "user",
        content: `Create a study plan for a ${examType} student.

Today is ${todayStr}.
Exam date: ${examDate}
Days left: ${daysLeft}
Available study time: ${hoursPerDay} hours per day.

If the exam is more than ${planningDays} days away, create a ${planningDays}-day high-priority sprint starting from today.

Syllabus:
${cleanedSyllabus}

Format strictly like this:

**DAY 1 — [Day Name]**
- Morning:
- Evening:

**Key Points:**
...

**Practice Questions:**
...

**Memory Tricks:**
...

Repeat this format for each day.

End with:
**FINAL CHECKLIST**
- ...
- ...
- ...`,
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
