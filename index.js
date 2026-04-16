require("dotenv").config();
const express = require("express");
const cors = require("cors");
const Groq = require("groq-sdk");

const app = express();

// ── CORS SETUP ───────────────────────────────────────────────
app.use(cors());
app.use(express.json());

// ── UTILITY: Syllabus Cleaner ────────────────────────────────
const cleanSyllabus = (text) => {
    return text
        .replace(/\d+\s*of\s*\d+/g, "")
        .replace(/[^\x20-\x7E\n]/g, "")
        .replace(/\n\s*\n/g, '\n')
        .trim()
        .substring(0, 6000);
};

// ── GROQ MULTI-KEY ROTATION ─────────────────────────────────
const GROQ_KEYS = [
    process.env.GROQ_API_KEY_1,
    process.env.GROQ_API_KEY_2,
    process.env.GROQ_API_KEY_3,
    process.env.GROQ_API_KEY_4,
].filter(Boolean);

let currentKeyIndex = 0;

function getGroqClient() {
    return new Groq({ apiKey: GROQ_KEYS[currentKeyIndex] });
}

function rotateKey() {
    currentKeyIndex = (currentKeyIndex + 1) % GROQ_KEYS.length;
    console.log(`🔄 Rotated to API key ${currentKeyIndex + 1}`);
}

async function groqChat(messages, maxTokens = 4000) {
    let attempts = 0;

    while (attempts < GROQ_KEYS.length) {
        try {
            const groq = getGroqClient();

            const chat = await groq.chat.completions.create({
                model: "llama-3.3-70b-versatile",
                max_tokens: maxTokens,
                temperature: 0.3,
                messages,
            });

            return chat.choices[0].message.content;

        } catch (e) {
            if (e.status === 429) {
                rotateKey();
                attempts++;
            } else {
                console.error("Groq error:", e);
                throw e;
            }
        }
    }

    throw new Error("All API keys rate limited.");
}

// ── HEALTH CHECK ─────────────────────────────────────────────
app.get("/health", (req, res) => {
    res.json({ status: "awake", app: "ExamPilot" });
});

// ── EXAMPILOT CORE ROUTE ─────────────────────────────────────
app.post("/study-plan", async (req, res) => {
    try {
        const {
            syllabus,
            examDate,
            hoursPerDay = 4,
            university = "Indian University",
            subject = ""
        } = req.body;

        // 🔒 Validation
        if (!syllabus || !examDate) {
            return res.status(400).json({
                success: false,
                error: "Syllabus and examDate are required"
            });
        }

        if (syllabus.length < 20) {
            return res.status(400).json({
                success: false,
                error: "Syllabus too short. Please paste full syllabus."
            });
        }

        // 📅 Correct Date Calculation
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const exam = new Date(examDate);
        exam.setHours(0, 0, 0, 0);

        if (isNaN(exam.getTime())) {
            return res.status(400).json({
                success: false,
                error: "Invalid exam date"
            });
        }

        const daysLeft = Math.max(1, Math.ceil(
            (exam - today) / (1000 * 60 * 60 * 24)
        ));

        console.log("📥 Request:", {
            daysLeft,
            hoursPerDay,
            university,
            subject
        });

        const cleanedSyllabus = cleanSyllabus(syllabus);

        // 🧠 AI CALL
        const plan = await groqChat([
            {
                role: "system",
                content: `You are ExamPilot — an expert Indian university exam coach.

You understand:
- Indian exam patterns (VTU, VIT, MU, DU, Anna University)
- Students are under time pressure
- Focus is scoring marks, not deep theory

You create highly practical, motivating, and realistic study plans.`
            },
            {
                role: "user",
                content: `Create a ${daysLeft}-day personalized study plan for a stressed Indian college student.

IMPORTANT:
- Focus on scoring marks
- Prioritize high-weightage and repeated topics
- Keep plan realistic (student may procrastinate)
- Include revision cycles

University: ${university}
Subject: ${subject}
Hours per day: ${hoursPerDay}

Syllabus:
${cleanedSyllabus}

Return ONLY in this exact clean markdown format:

**EXAMPILOT — ${daysLeft}-DAY PLAN**
${university} | ${subject}

For EACH DAY include:

**DAY 1 — [Day Name]**
- Morning (${Math.ceil(hoursPerDay / 2)} hrs): Topic...
- Evening (${Math.floor(hoursPerDay / 2)} hrs): Topic...

**Key Points (Exam-Focused):**
- Important concepts
- Definitions / formulas / derivations

**Practice Questions (University Exam Style):**
1. Question
2. Question
3. Question
4. Question
5. Question

**Memory Tricks:**
- Mnemonics / shortcuts

Repeat for ALL days.

At the end include:

**FINAL REVISION STRATEGY (1 DAY BEFORE EXAM)**

**EXAM DAY MORNING CHECKLIST**
- Quick revision tips
- Confidence boost`
            }
        ]);

        return res.json({
            success: true,
            daysLeft,
            plan,
            message: "✅ Your personalized study plan is ready!"
        });

    } catch (error) {
        console.error("Study plan error:", error);

        return res.status(500).json({
            success: false,
            error: "Failed to generate plan. Please try again."
        });
    }
});

// ── SERVER START ─────────────────────────────────────────────
const PORT = process.env.PORT || 5001;

app.listen(PORT, "0.0.0.0", () => {
    console.log(`🚀 ExamPilot Engine Live on ${PORT}`);
});