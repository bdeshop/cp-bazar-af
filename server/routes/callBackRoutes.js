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

    // Trim username (তোমার পুরানো লজিক)
    username = username.substring(0, 45);
    username = username.substring(0, username.length - 2);

    const player = await Admin.findOne({ username });
    if (!player) {
      return res.status(404).json({
        success: false,
        message: "User not found!",
      });
    }

    console.log("Matched player ID ->", player._id);

    const amountFloat = parseFloat(amount);
    if (isNaN(amountFloat)) {
      return res.status(400).json({
        success: false,
        message: "Invalid amount",
      });
    }

    // Determine if player lost money
    let isPlayerLoss = false;
    let playerNetChange = 0;

    if (bet_type === "BET") {
      playerNetChange = -amountFloat;
      isPlayerLoss = true;
    } else if (bet_type === "SETTLE") {
      playerNetChange = amountFloat;
      if (amountFloat <= 0) isPlayerLoss = true;
    } else {
      isPlayerLoss = false;
    }

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

    const newBalance = (player.balance || 0) + playerNetChange;

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

    // === Multi-Level Game Loss Commission Logic ===
    if (isPlayerLoss && player.referredBy) {
      const lossAmount = Math.abs(playerNetChange); // যত টাকা হারিয়েছে

      // Level 1: Direct Referrer (Master Affiliate)
      const referrer = await Admin.findById(player.referredBy);
      if (referrer && referrer.gameLossCommission > 0) {
        const masterRate = referrer.gameLossCommission / 100;
        const masterCommission = lossAmount * masterRate;

        if (masterCommission > 0) {
          await Admin.findByIdAndUpdate(referrer._id, {
            $inc: { gameLossCommissionBalance: masterCommission },
          });
          console.log(`Master Commission: +৳${masterCommission.toFixed(2)} → ${referrer.username}`);
        }

        // Level 2: Super Affiliate (যে Master কে রেফার করেছে)
        if (referrer.referredBy) {
          const superReferrer = await Admin.findById(referrer.referredBy);

          if (
            superReferrer &&
            superReferrer.role === "super-affiliate" &&
            superReferrer.gameLossCommission > referrer.gameLossCommission
          ) {
            const superRate = superReferrer.gameLossCommission / 100;
            const totalSuperCommission = lossAmount * superRate;
            const superBonus = totalSuperCommission - masterCommission; // বাকি টাকা

            if (superBonus > 0) {
              await Admin.findByIdAndUpdate(superReferrer._id, {
                $inc: { gameLossCommissionBalance: superBonus },
              });
              console.log(`Super Bonus: +৳${superBonus.toFixed(2)} → ${superReferrer.username}`);
            }
          }
        }
      }
    }

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
