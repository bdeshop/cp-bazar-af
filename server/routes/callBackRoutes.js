// routes/callback.js
import express from "express";
import Admin from "../models/Admin.js";
import { ObjectId } from "mongodb";

const router = express.Router();

router.post("/", async (req, res) => {
  try {
    let {
      account_id,
      username,
      provider_code,
      amount,
      game_code,
      verification_key,
      bet_type,
      transaction_id,
      times,
    } = req.body;

    console.log("Callback received ->", {
      account_id,
      username,
      provider_code,
      amount,
      game_code,
      bet_type,
      transaction_id,
    });

    // Required fields validation
    if (!username || !provider_code || !amount || !game_code || !bet_type) {
      return res.status(400).json({
        success: false,
        message: "Required fields missing.",
      });
    }

    // Trim username exactly as you had (আপনার পুরানো লজিক)
    username = username.substring(0, 45);
    username = username.substring(0, username.length - 2); // removes last 2 chars (e.g., "roni")

    // Find user in Admin collection (আপনার নতুন মডেল)
    const matchedUser = await Admin.findOne({ username: username });
    if (!matchedUser) {
      return res.status(404).json({
        success: false,
        message: "User not found!",
      });
    }

    console.log("Matched user ID ->", matchedUser._id);

    // Prepare game record
    const gameRecord = {
      username,
      provider_code,
      game_code,
      bet_type,
      amount: parseFloat(amount),
      transaction_id: transaction_id || null,
      verification_key: verification_key || null,
      times: times || null,
      status: bet_type === "SETTLE" ? "won" : "lost",
      createdAt: new Date(),
    };

    // Balance calculation
    let newBalance = matchedUser.balance || 0;
    if (bet_type === "BET") {
      newBalance -= parseFloat(amount);
    } else if (bet_type === "SETTLE") {
      newBalance += parseFloat(amount);
    }

    // Update user (balance + push gameHistory)
    const updatedUser = await Admin.findOneAndUpdate(
      { _id: new ObjectId(matchedUser._id) },
      {
        $set: { balance: newBalance },
        $push: { gameHistory: gameRecord },
      },
      { new: true } // return updated document
    );

    if (!updatedUser) {
      return res.status(500).json({
        success: false,
        message: "Failed to update user data.",
      });
    }

    // Success response
    res.json({
      success: true,
      message: "Callback processed successfully.",
      data: {
        username,
        new_balance: updatedUser.balance,
        gameRecord,
      },
    });
  } catch (error) {
    console.error("Callback error:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});

export default router;
