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

    // Trim username (তোমার পুরানো লজিক অনুযায়ী)
    username = username.substring(0, 45);
    username = username.substring(0, username.length - 2); // removes last 2 chars

    // Find the user who played the game
    const player = await Admin.findOne({ username });
    if (!player) {
      return res.status(404).json({
        success: false,
        message: "User not found!",
      });
    }

    console.log("Matched player ID ->", player._id);

    // Parse amount
    const amountFloat = parseFloat(amount);
    if (isNaN(amountFloat)) {
      return res.status(400).json({
        success: false,
        message: "Invalid amount",
      });
    }

    // Determine if this is a loss for the player
    let isPlayerLoss = false;
    let playerNetChange = 0;

    if (bet_type === "BET") {
      playerNetChange = -amountFloat;
      isPlayerLoss = true; // BET means money deducted
    } else if (bet_type === "SETTLE") {
      playerNetChange = amountFloat; // SETTLE can be win or cancel
      // If SETTLE amount is 0 or negative, consider as loss or no win
      if (amountFloat <= 0) isPlayerLoss = true;
    } else {
      // For other types (CANCEL, etc.), we don't give commission
      isPlayerLoss = false;
    }

    // Prepare game record
    const gameRecord = {
      username,
      provider_code,
      game_code,
      bet_type,
      amount: amountFloat,
      transaction_id: transaction_id || null,
      verification_key: verification_key || null,
      times: times || null,
      status: bet_type === "SETTLE" && amountFloat > 0 ? "won" : "lost",
      createdAt: new Date(),
    };

    // Calculate new balance for player
    let newBalance = (player.balance || 0) + playerNetChange;

    // Update player balance and game history
    const updatedPlayer = await Admin.findOneAndUpdate(
      { _id: player._id },
      {
        $set: { balance: newBalance },
        $push: { gameHistory: gameRecord },
      },
      { new: true }
    );

    if (!updatedPlayer) {
      return res.status(500).json({
        success: false,
        message: "Failed to update player data.",
      });
    }

    // === Referral Commission Logic (Only on Player Loss) ===
    if (isPlayerLoss && player.referredBy) {
      const referrer = await Admin.findById(player.referredBy);

      if (referrer && referrer.gameLossCommission > 0) {
        const commissionRate = referrer.gameLossCommission;
        const commissionAmount = commissionRate;

        if (commissionAmount > 0) {
          await Admin.findByIdAndUpdate(
            referrer._id,
            {
              $inc: { gameLossCommissionBalance: commissionAmount },
            }
          );

          console.log(
            `Commission Added: ${commissionAmount} to Referrer ${referrer.username} (ID: ${referrer._id})`
          );
        }
      }
    }

    // Success response
    res.json({
      success: true,
      message: "Callback processed successfully.",
      data: {
        username,
        new_balance: updatedPlayer.balance,
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
