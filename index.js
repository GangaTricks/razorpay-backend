import express from "express";
import cors from "cors";
import Razorpay from "razorpay";
import admin from "firebase-admin";

/* ======================
   APP SETUP
====================== */
const app = express();

app.use(cors({
  origin: [
    "https://gangasolvo.web.app",
    "https://gangasolvo.firebaseapp.com",
    "http://localhost:8080"
  ],
  methods: ["GET", "POST"],
  allowedHeaders: ["Content-Type"]
}));

app.use(express.json());

/* ======================
   ENV CHECK
====================== */
if (!process.env.PORT) throw new Error("PORT missing");
if (!process.env.RAZORPAY_KEY_ID) throw new Error("RAZORPAY_KEY_ID missing");
if (!process.env.RAZORPAY_KEY_SECRET) throw new Error("RAZORPAY_KEY_SECRET missing");
if (!process.env.FIREBASE_SERVICE_ACCOUNT) throw new Error("FIREBASE_SERVICE_ACCOUNT missing");

/* ======================
   FIREBASE ADMIN
====================== */
admin.initializeApp({
  credential: admin.credential.cert(
    JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
  ),
  databaseURL:
    "https://gangasolvo-default-rtdb.asia-southeast1.firebasedatabase.app"
});

/* ======================
   RAZORPAY (LIVE)
====================== */
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET
});

/* ======================
   HEALTH CHECK
====================== */
app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

/* ======================
   CREATE PAYMENT LINK
====================== */
app.post("/create-payment-link", async (req, res) => {
  try {
    const { amount, uid, courseId, email } = req.body;

    if (!amount || !uid || !courseId || !email) {
      return res.status(400).json({ error: "Invalid payload" });
    }

    const payload = {
      amount: Number(amount) * 100,   // paise
      currency: "INR",
      description: "Premium Course",
      customer: { email },
      notes: { uid, courseId }
    };

    console.log("📤 Razorpay payload:", payload);

    const link = await razorpay.paymentLink.create(payload);

    res.json({
      short_url: link.short_url
    });

  } catch (err) {
    console.error("❌ Razorpay ERROR:", err);

    res.status(500).json({
      error: "Payment link creation failed",
      razorpay: err?.error || err?.message || err
    });
  }
});

/* ======================
   START SERVER
====================== */
app.listen(Number(process.env.PORT), "0.0.0.0", () => {
  console.log("✅ Backend running on", process.env.PORT);
});
