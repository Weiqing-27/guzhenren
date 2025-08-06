const express = require("express");
const bcrypt = require("bcrypt");

const router = express.Router();

// 用户注册
router.post("/register", async (req, res) => {
  const { username, password } = req.body;
  const supabase = req.app.get('supabase');

  // 验证输入数据
  if (!username || !password) {
    return res.status(400).json({ error: "用户名和密码不能为空" });
  }

  try {
    // 检查用户名是否存在
    const { data: existingUser, error: selectError } = await supabase
      .from("custom_user")
      .select("username")
      .eq("username", username);

    if (selectError) {
      console.error("Supabase查询错误:", selectError);
      return res.status(500).json({ error: "数据库查询错误" });
    }

    if (existingUser && existingUser.length > 0) {
      return res.status(400).json({ error: "用户名已存在" });
    }

    // 密码加密
    if (typeof password !== "string" || password.length < 6) {
      return res.status(400).json({ error: "密码必须是至少6个字符的字符串" });
    }

    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(password, saltRounds);

    // 创建用户，包含默认头像和角色
    const { data: newUser, error: insertError } = await supabase
      .from("custom_user")
      .insert([
        {
          username,
          password_hash: passwordHash,
          avatar_url: 'https://ui-avatars.com/api/?name=' + username.charAt(0).toUpperCase() + '&background=random',
          role: 'user' // 默认角色为普通用户
        },
      ])
      .select();

    if (insertError) {
      console.error("用户创建错误:", insertError);
      return res.status(500).json({ error: "用户创建失败" });
    }

    res.status(201).json({
       userId: newUser[0].userId,
      username: newUser[0].username,
      avatar_url: newUser[0].avatar_url,
      role: newUser[0].role
    });
  } catch (error) {
    console.error("注册错误:", error.message);
    res.status(500).json({ error: "服务器错误", details: error.message });
  }
});

// 用户登录
router.post("/login", async (req, res) => {
  const { username, password } = req.body;
  const supabase = req.app.get('supabase');

  // 验证输入
  if (!username || !password) {
    return res.status(400).json({ error: "用户名和密码不能为空" });
  }

  try {
    // 查询用户（包含头像和角色信息）
    const { data: users, error } = await supabase
      .from("custom_user")
      .select("userId, username, password_hash, avatar_url, role")
      .eq("username", username);

    if (error) {
      console.error("登录查询错误:", error);
      return res.status(500).json({ error: "数据库查询错误" });
    }

    if (!users || users.length === 0) {
      return res.status(401).json({ error: "用户名或密码错误" });
    }

    const user = users[0];

    // 验证密码
    const passwordMatch = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatch) {
      return res.status(401).json({ error: "用户名或密码错误" });
    }

    res.status(200).json({
      code: 200,
      message: "登录成功",
      data: {
        userId: user.userId,
        username: user.username,
        avatar_url: user.avatar_url,
        role: user.role
      },
    });
  } catch (error) {
    console.error("登录错误:", error.message);
    res.status(500).json({ error: "服务器错误", details: error.message });
  }
});

// 更新用户头像
router.put("/avatar", async (req, res) => {
  const { userId, avatarUrl } = req.body;
  const supabase = req.app.get('supabase');

  // 验证输入
  if (!userId || !avatarUrl) {
    return res.status(400).json({ error: "用户ID和头像URL不能为空" });
  }

  try {
    // 更新用户头像
    const { data, error } = await supabase
      .from("custom_user")
      .update({ avatar_url: avatarUrl })
      .eq("userId", userId)
      .select("userId, username, avatar_url, role");

    if (error) {
      console.error("更新头像错误:", error);
      return res.status(500).json({ error: "更新头像失败" });
    }

    if (!data || data.length === 0) {
      return res.status(404).json({ error: "用户不存在" });
    }

    res.status(200).json({
      code: 200,
      message: "头像更新成功",
      data: data[0]
    });
  } catch (error) {
    console.error("更新头像异常:", error.message);
    res.status(500).json({ error: "服务器错误", details: error.message });
  }
});

// 获取用户信息
router.get("/profile/:userId", async (req, res) => {
  const { userId } = req.params;
  const supabase = req.app.get('supabase');

  try {
    // 查询用户信息
    const { data, error } = await supabase
      .from("custom_user")
      .select("userId, username, avatar_url, role, created_at")
      .eq("userId", userId);

    if (error) {
      console.error("获取用户信息错误:", error);
      return res.status(500).json({ error: "获取用户信息失败" });
    }

    if (!data || data.length === 0) {
      return res.status(404).json({ error: "用户不存在" });
    }

    res.status(200).json({
      code: 200,
      message: "获取用户信息成功",
      data: data[0]
    });
  } catch (error) {
    console.error("获取用户信息异常:", error.message);
    res.status(500).json({ error: "服务器错误", details: error.message });
  }
});

module.exports = router;