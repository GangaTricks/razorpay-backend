import express from "express";
import Razorpay from "razorpay";
import cors from "cors";
import crypto from "crypto";
import admin from "firebase-admin";

const app = express();
app.use(cors());
app.use(express.json());

/* ---------- Firebase Admin ---------- */
admin.initializeApp({
  credential: admin.credential.cert(
    JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
  ),
  databaseURL: "https://gangasolvo-default-rtdb.asia-southeast1.firebasedatabase.app"
});

/* ---------- Razorpay ---------- */
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET
});

/* ---------- Create Order ---------- */
app.post("/create-order", async (req, res) => {
  const { amount, uid, courseId } = req.body;

  const order = await razorpay.orders.create({
    amount: amount * 01,
    currency: "INR",
    receipt: `${uid}_${courseId}_${Date.now()}`
  });

  res.json(order);
});

/* ---------- Verify Payment ---------- */
app.post("/verify-payment", async (req, res) => {
  const {
    razorpay_order_id,
    razorpay_payment_id,
    razorpay_signature,
    uid,
    courseId
  } = req.body;

  const body = razorpay_order_id + "|" + razorpay_payment_id;

  const expected = crypto
    .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
    .update(body)
    .digest("hex");

  if (expected !== razorpay_signature) {
    return res.status(400).json({ success: false });
  }

  await admin.database()
    .ref(`users/${uid}/courses/${courseId}`)
    .set({
      paid: true,
      paymentId: razorpay_payment_id,
      time: Date.now()
    });

  res.json({ success: true });
});

/* ---------- Start ---------- */
app.listen(3000, () => console.log("Backend running"));
