import express from "express";
import Admin from "../models/Admin.js";
import bcrypt from "bcryptjs";

const router = express.Router();

// POST /register
router.post("/register", async (req, res) => {
  const { username, email, whatsapp, password, referral } = req.body;

  try {
    // Check if user already exists
    const exists = await Admin.findOne({ $or: [{ email }, { username }] });
    if (exists) return res.status(400).json({ message: "User already exists" });

    let referredBy = null;
    let referrer = null;

    if (referral) {
      referrer = await Admin.findOne({ referralCode: referral });
      if (!referrer)
        return res.status(400).json({ message: "Invalid referral code" });
      referredBy = referrer._id;
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const user = new Admin({
      username,
      email,
      whatsapp,
      password: hashedPassword,
      role: referral ? "master-affiliate" : "super-affiliate",
      referredBy,
      isActive: false, // সবাই প্রথমে inactive থাকবে
    });

    const savedUser = await user.save();

    // যদি রেফারার থাকে (মানে রেফার লিংক দিয়ে এসেছে)
    if (referrer) {
      // রেফারারের createdUsers ও pendingRequests এ যোগ করা
      await Admin.findByIdAndUpdate(referrer._id, {
        $push: {
          createdUsers: savedUser._id,
          pendingRequests: savedUser._id,
        },
      });

      // এখানে মূল কাজ: Refer Commission যোগ করা
      const referBonus = referrer.referCommission || 0; // যদি ১০ হয়, তাহলে ১০ টাকা

      if (referBonus > 0) {
        await Admin.findByIdAndUpdate(referrer._id, {
          $inc: {
            referCommissionBalance: referBonus, // বোনাস যোগ হচ্ছে
          },
        });

        // অপশনাল: লগ রাখতে চাইলে একটা Transaction মডেলে সেভ করতে পারো
        // await new ReferralBonus({ referrer: referrer._id, newUser: savedUser._id, amount: referBonus }).save();
      }
    }

    res.status(201).json({
      message: "Registration successful",
      user: {
        id: savedUser._id,
        username: savedUser.username,
        email: savedUser.email,
        role: savedUser.role,
        isActive: savedUser.isActive,
        referralCode: savedUser.referralCode,
        referralLink: `${process.env.VITE_API_URL}/register?ref=${savedUser.referralCode}`,
      },
    });
  } catch (err) {
    console.error("Register error:", err);
    res.status(500).json({ message: err.message || "Server error" });
  }
});

// routes/auth.js → POST /main/register
router.post("/main/register", async (req, res) => {
  const { username, email, whatsapp, password, referral } = req.body;

  try {
    // ইউজার আগে থেকে আছে কিনা?
    const exists = await Admin.findOne({ $or: [{ email }, { username }] });
    if (exists) return res.status(400).json({ message: "User already exists" });

    let referredBy = null;
    let referrer = null;
    let newUserRole = "user";
    let superReferrer = null; // যে Super Affiliate Master কে রেফার করেছে

    // রেফারেল কোড চেক
    if (referral) {
      referrer = await Admin.findOne({ referralCode: referral });
      if (!referrer) {
        return res.status(400).json({ message: "Invalid referral code" });
      }
      referredBy = referrer._id;

      // নতুন ইউজারের রোল নির্ধারণ
      if (referrer.role === "super-affiliate") {
        newUserRole = "master-affiliate";
      } else if (referrer.role === "master-affiliate") {
        newUserRole = "user";
      }
    }

    // পাসওয়ার্ড হ্যাশ
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // isActive: master-affiliate হলে approval দরকার
    const isActive = newUserRole === "master-affiliate" ? false : true;

    // নতুন ইউজার তৈরি
    const user = new Admin({
      username,
      email,
      whatsapp,
      password: hashedPassword,
      role: newUserRole,
      referredBy,
      isActive,
    });

    const savedUser = await user.save();

    // === রেফার বোনাস লজিক (মূল আপডেট) ===
    if (referredBy && referrer) {
      const updateReferrer = { $push: { createdUsers: savedUser._id } };
      if (newUserRole === "master-affiliate") {
        updateReferrer.$push.pendingRequests = savedUser._id;
      }
      await Admin.findByIdAndUpdate(referredBy, updateReferrer);

      // শুধু Master Affiliate → User রেজিস্ট্রেশনে বোনাস
      if (newUserRole === "user" && referrer.role === "master-affiliate") {
        const referBonus = referrer.referCommission || 0; // Master এর বোনাস (যেমন ৳100)

        if (referBonus > 0) {
          // ১. Master Affiliate কে তার পুরো বোনাস দাও
          await Admin.findByIdAndUpdate(referredBy, {
            $inc: { referCommissionBalance: referBonus },
          });

          // ২. Master এর উপরের Super Affiliate খুঁজে বের করো
          if (referrer.referredBy) {
            superReferrer = await Admin.findById(referrer.referredBy);
            if (superReferrer && superReferrer.role === "super-affiliate") {
              const superBonusAmount = superReferrer.referCommission || 0;
              const superReferBonus = superBonusAmount - referBonus; // যেমন: 150 - 100 = 50
              console.log(superReferBonus)

              if (superReferBonus > 0) {
                await Admin.findByIdAndUpdate(superReferrer._id, {
                  $inc: { referCommissionBalance: superReferBonus },
                });
              }
            }
          }
        }
      }
    }

    // সাকসেস রেসপন্স
    res.status(201).json({
      message: "Registration successful",
      user: {
        id: savedUser._id,
        username: savedUser.username,
        email: savedUser.email,
        role: savedUser.role,
        isActive: savedUser.isActive,
        referralCode: savedUser.referralCode,
        referralLink: `${process.env.VITE_CLIENT_URL}/register?ref=${savedUser.referralCode}`,
      },
    });
  } catch (err) {
    console.error("Register error:", err);
    res.status(500).json({ message: err.message || "Server error" });
  }
});

// POST /login
router.post("/login", async (req, res) => {
  const { username, password } = req.body;

  try {
    const user = await Admin.findOne({ username });
    if (!user) return res.status(400).json({ message: "Invalid credentials" });

    if (!user.isActive) {
      return res.status(403).json({ message: "Account is pending approval" });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch)
      return res.status(400).json({ message: "Invalid credentials" });

    res.json({
      message: "Login successful",
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        role: user.role,
        isActive: user.isActive,
        referralCode: user.referralCode,
        referralLink: `${process.env.VITE_API_URL}/register?ref=${user.referralCode}`,
      },
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// routes/admin.js
router.get("/admin", async (req, res) => {
  try {
    const id = req.query.id;
    if (!id) return res.status(401).json({ message: "No user ID" });

    const user = await Admin.findById(id)
      .select("-password")
      .populate({
        path: "pendingRequests",
        select:
          "username email whatsapp balance password isActive gameLossCommission depositCommission referCommission commissionBalance",
      })
      .populate({
        path: "createdUsers",
        select:
          "username email whatsapp balance password isActive gameLossCommission depositCommission referCommission commissionBalance",
      });

    if (!user) return res.status(404).json({ message: "User not found" });

    res.json({ user });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
});

// routes/admin.js → PATCH /approve-user/:id
router.patch("/approve-user/:id", async (req, res) => {
  const { id } = req.params;
  const {
    gameLossCommission = 0,
    depositCommission = 0,
    referCommission = 0,
  } = req.body;

  try {
    const user = await Admin.findByIdAndUpdate(
      id,
      {
        isActive: true,
        gameLossCommission: Number(gameLossCommission),
        depositCommission: Number(depositCommission),
        referCommission: Number(referCommission),
      },
      { new: true }
    ).select(
      "username email whatsapp isActive gameLossCommission depositCommission referCommission commissionBalance"
    );

    if (!user) return res.status(404).json({ message: "User not found" });

    // pendingRequests থেকে রিমুভ + createdUsers এ যোগ
    if (user.referredBy) {
      await Admin.findByIdAndUpdate(user.referredBy, {
        $pull: { pendingRequests: id },
      });
    }

    res.json({ message: "User updated & activated", user });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// PATCH /deactivate-user/:id
router.patch("/deactivate-user/:id", async (req, res) => {
  const { id } = req.params;

  try {
    const user = await Admin.findByIdAndUpdate(
      id,
      { isActive: false },
      { new: true }
    );

    if (!user) return res.status(404).json({ message: "User not found" });

    res.json({ message: "User deactivated", user });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.put("/profile", async (req, res) => {
  try {
    const { userId, firstName, lastName, username, email, whatsapp, password } =
      req.body;

    // userId ছাড়া হলে এরর
    if (!userId) {
      return res.status(400).json({ message: "userId is required" });
    }

    const user = await Admin.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // আপডেট ফিল্ড
    user.firstName = firstName || user.firstName;
    user.lastName = lastName || user.lastName;
    user.username = username || user.username;
    user.email = email || user.email;
    user.whatsapp = whatsapp || user.whatsapp;

    if (password) {
      user.password = await bcrypt.hash(password, 10);
    }

    await user.save();

    // রেসপন্স
    res.json({
      _id: user._id,
      firstName: user.firstName,
      lastName: user.lastName,
      username: user.username,
      email: user.email,
      whatsapp: user.whatsapp,
      referralCode: user.referralCode,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
});

// POST /api/update-user-credentials/:id
router.patch("/update-master-affiliate-credentials/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { username, password } = req.body;

    const user = await Admin.findById(id);
    if (!user) return res.status(404).json({ message: "User not found" });

    // ইউজারনেম আপডেট
    if (username && username !== user.username) {
      const existing = await Admin.findOne({ username });
      if (existing)
        return res.status(400).json({ message: "Username already taken" });
      user.username = username;
    }

    // পাসওয়ার্ড আপডেট (যদি দেওয়া থাকে)
    if (password) {
      const salt = await bcrypt.genSalt(10);
      user.password = await bcrypt.hash(password, salt);
    }

    await user.save();
    res.json({ message: "User updated successfully", user });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// routes/admin.js
router.get("/super-affiliates", async (req, res) => {
  try {
    const superAffiliates = await Admin.find({
      role: "super-affiliate",
    }).select(
      "username email whatsapp balance password isActive gameLossCommission depositCommission referCommission commissionBalance"
    );

    res.json({ users: superAffiliates });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// routes/admin.js
router.get("/master-affiliates", async (req, res) => {
  try {
    const masterAffiliates = await Admin.find({
      role: "master-affiliate",
    }).select(
      "username email whatsapp balance password isActive gameLossCommission depositCommission referCommission commissionBalance"
    );

    res.json({ users: masterAffiliates });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST: Create New Super Affiliate
router.post("/create/super-affiliates", async (req, res) => {
  try {
    const {
      username,
      email,
      password,
      whatsapp,
      gameLossCommission,
      depositCommission,
      referCommission,
    } = req.body;

    // Validation
    if (!username || !email || !password || !whatsapp) {
      return res
        .status(400)
        .json({ message: "All required fields must be filled" });
    }

    // Check if username or email already exists
    const existingUser = await Admin.findOne({
      $or: [{ username }, { email }],
    });
    if (existingUser) {
      return res
        .status(400)
        .json({ message: "Username or Email already exists" });
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Create new Super Affiliate
    const newUser = new Admin({
      username,
      email,
      password: hashedPassword,
      whatsapp,
      role: "super-affiliate",
      gameLossCommission: parseFloat(gameLossCommission) || 0,
      depositCommission: parseFloat(depositCommission) || 0,
      referCommission: parseFloat(referCommission) || 0,
      isActive: false, // Default inactive, must activate later
    });

    await newUser.save();

    res.status(201).json({
      message: "Super Affiliate created successfully",
      user: {
        _id: newUser._id,
        username: newUser.username,
        email: newUser.email,
        whatsapp: newUser.whatsapp,
        role: newUser.role,
        isActive: newUser.isActive,
      },
    });
  } catch (error) {
    console.error("Create Super Affiliate Error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// POST: Create New Master Affiliate
router.post("/create/master-affiliates", async (req, res) => {
  try {
    const {
      username,
      email,
      password,
      whatsapp,
      gameLossCommission,
      depositCommission,
      referCommission,
      referredBy, // Super Affiliate ID
    } = req.body;

    // Validation
    if (!username || !email || !password || !whatsapp || !referredBy) {
      return res
        .status(400)
        .json({ message: "All required fields must be filled" });
    }

    // Check if username or email already exists
    const existingUser = await Admin.findOne({
      $or: [{ username }, { email }],
    });
    if (existingUser) {
      return res
        .status(400)
        .json({ message: "Username or Email already exists" });
    }

    // Check if referredBy (Super Affiliate) exists
    const superAffiliate = await Admin.findById(referredBy);
    if (!superAffiliate || superAffiliate.role !== "super-affiliate") {
      return res.status(400).json({ message: "Invalid Super Affiliate" });
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Create new Master Affiliate
    const newMaster = new Admin({
      username,
      email,
      password: hashedPassword,
      whatsapp,
      role: "master-affiliate",
      gameLossCommission: parseFloat(gameLossCommission) || 0,
      depositCommission: parseFloat(depositCommission) || 0,
      referCommission: parseFloat(referCommission) || 0,
      referredBy: superAffiliate._id,
      isActive: false,
    });

    await newMaster.save();

    // Add new master to super affiliate's createdUsers
    await Admin.findByIdAndUpdate(superAffiliate._id, {
      $push: { createdUsers: newMaster._id },
    });

    res.status(201).json({
      message: "Master Affiliate created successfully",
      user: {
        _id: newMaster._id,
        username: newMaster.username,
        email: newMaster.email,
        role: newMaster.role,
        referredBy: superAffiliate.username,
      },
    });
  } catch (error) {
    console.error("Create Master Affiliate Error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// GET all normal users
router.get("/users", async (req, res) => {
  try {
    const users = await Admin.find({ role: "user" }).select("-password");
    res.json({ users });
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

router.get("/users/:id", async (req, res) => {
  try {
    const user = await Admin.findById(req.params.id).select("-password");

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    res.json(user);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

router.put("/users/:id", async (req, res) => {
  try {
    const updates = req.body;

    // Hash password only if provided and not empty
    if (updates.password && updates.password.trim() !== "") {
      updates.password = await bcrypt.hash(updates.password, 10);
    } else {
      delete updates.password; // Don't update password if blank
    }

    const updatedUser = await Admin.findByIdAndUpdate(
      req.params.id,
      { $set: updates },
      { new: true, runValidators: true }
    ).select("-password");

    if (!updatedUser) {
      return res.status(404).json({ message: "User not found" });
    }

    res.json(updatedUser);
  } catch (err) {
    console.error("Update user error:", err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
});

// CREATE normal user
router.post("/create/user", async (req, res) => {
  const {
    username,
    email,
    password,
    whatsapp,
    referredBy,
    gameLossCommission,
    depositCommission,
    referCommission,
  } = req.body;

  if (!username || !email || !password || !whatsapp || !referredBy)
    return res.status(400).json({ message: "All fields required" });

  const exists = await Admin.findOne({ $or: [{ username }, { email }] });
  if (exists)
    return res.status(400).json({ message: "Username or email exists" });

  const master = await Admin.findById(referredBy);
  if (!master || master.role !== "master-affiliate")
    return res.status(400).json({ message: "Invalid Master Affiliate" });

  const salt = await bcrypt.genSalt(10);
  const hashed = await bcrypt.hash(password, salt);

  const newUser = new Admin({
    username,
    email,
    password: hashed,
    whatsapp,
    role: "user",
    gameLossCommission: parseFloat(gameLossCommission) || 0,
    depositCommission: parseFloat(depositCommission) || 0,
    referCommission: parseFloat(referCommission) || 0,
    referredBy: master._id,
    isActive: true,
  });

  await newUser.save();
  await Admin.findByIdAndUpdate(master._id, {
    $push: { createdUsers: newUser._id },
  });

  res.status(201).json({ message: "User created", user: newUser });
});

// Toggle active
router.patch("/toggle-user/:id", async (req, res) => {
  await Admin.findByIdAndUpdate(req.params.id, { isActive: req.body.isActive });
  res.json({ message: "Updated" });
});

// Update credentials
router.patch("/update-user-credentials/:id", async (req, res) => {
  const { username, password } = req.body;
  const update = {};
  if (username) update.username = username;
  if (password) {
    const salt = await bcrypt.genSalt(10);
    update.password = await bcrypt.hash(password, salt);
  }
  await Admin.findByIdAndUpdate(req.params.id, update);
  res.json({ message: "Updated" });
});

// PATCH: Update User Commission
router.patch("/update-user-commission/:id", async (req, res) => {
  try {
    const { gameLossCommission, depositCommission, referCommission } = req.body;
    await Admin.findByIdAndUpdate(req.params.id, {
      gameLossCommission: parseFloat(gameLossCommission) || 0,
      depositCommission: parseFloat(depositCommission) || 0,
      referCommission: parseFloat(referCommission) || 0,
    });
    res.json({ message: "Commission updated" });
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

// routes/profile.js বা যেখানে রাখো
router.put("/update-name", async (req, res) => {
  try {
    const { userId, firstName, lastName, username, email} =
      req.body;

    // userId ছাড়া হলে এরর
    if (!userId) {
      return res.status(400).json({ message: "userId is required" });
    }

    const user = await Admin.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // আপডেট ফিল্ড
    user.firstName = firstName || user.firstName;
    user.lastName = lastName || user.lastName;
    user.username = username || user.username;
    user.email = email || user.email;

    await user.save();

    // রেসপন্স
    res.json({
      _id: user._id,
      firstName: user.firstName,
      lastName: user.lastName,
      username: user.username,
      email: user.email,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
});

// Update Password
router.put("/update-password", async (req, res) => {
  try {
    const { userId, currentPassword, newPassword } = req.body;

    if (!userId || !currentPassword || !newPassword) {
      return res.status(400).json({ message: "All fields are required" });
    }

    // Find user
    const user = await Admin.findById(userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    // Check current password
    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) return res.status(401).json({ message: "Current password is incorrect" });

    // Hash new password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(newPassword, salt);

    // Update password
    user.password = hashedPassword;
    await user.save();

    res.status(200).json({ message: "Password updated successfully" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
});



export default router;
