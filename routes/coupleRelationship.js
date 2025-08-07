// routes/coupleRelationship.js
const express = require("express");
const router = express.Router();


// 发送情侣邀请（通过用户名）
router.post("/invite", async (req, res) => {
  const { inviter_id, invitee_username, message } = req.body;
  const supabase = req.app.get('supabase');

  try {
    // 验证邀请者是否存在（使用转义的字段名）
    const { data: inviterData, error: inviterError } = await supabase
      .from("custom_user")
      .select('"userId", username')
      .eq('"userId"', inviter_id)
      .single();

    if (inviterError || !inviterData) {
      return res.status(400).json({
        error: "邀请者不存在",
        details: `用户ID ${inviter_id} 在系统中找不到`
      });
    }

    // 验证被邀请者是否存在
    const { data: inviteeData, error: inviteeError } = await supabase
      .from("custom_user")
      .select('"userId", username')
      .eq("username", invitee_username)
      .single();

    if (inviteeError || !inviteeData) {
      return res.status(400).json({
        error: "被邀请者不存在",
        details: `用户名 ${invitee_username} 在系统中找不到`
      });
    }

    // 检查不能邀请自己
    if (inviter_id === inviteeData.userId) {
      return res.status(400).json({
        error: "不能邀请自己",
        details: "不能向自己发送情侣邀请"
      });
    }

    // 检查是否已经存在情侣关系
    const { data: existingCouple, error: coupleError } = await supabase
      .from("couples")
      .select("id")
      .or(`and(user1_id.eq.${inviter_id},user2_id.eq.${inviteeData.userId}),and(user1_id.eq.${inviteeData.userId},user2_id.eq.${inviter_id})`);

    if (coupleError) {
      console.error("检查情侣关系错误:", coupleError);
      return res.status(500).json({ error: "检查情侣关系失败" });
    }

    if (existingCouple && existingCouple.length > 0) {
      return res.status(400).json({
        error: "情侣关系已存在",
        details: "你们已经是情侣关系了"
      });
    }

    // 检查是否已经发送过邀请
    const { data: existingInvitation, error: invitationError } = await supabase
      .from("couple_invitations")
      .select("id, status")
      .or(`and(inviter_id.eq.${inviter_id},invitee_id.eq.${inviteeData.userId}),and(inviter_id.eq.${inviteeData.userId},invitee_id.eq.${inviter_id})`)
      .in("status", ["pending", "accepted"]);

    if (invitationError) {
      console.error("检查邀请状态错误:", invitationError);
      return res.status(500).json({ error: "检查邀请状态失败" });
    }

    if (existingInvitation && existingInvitation.length > 0) {
      const pendingInvitation = existingInvitation.find(inv => inv.status === "pending");
      if (pendingInvitation) {
        return res.status(400).json({
          error: "邀请已发送",
          details: "邀请已发送，请等待对方确认"
        });
      }

      return res.status(400).json({
        error: "已存在有效邀请",
        details: "已存在情侣关系或邀请"
      });
    }

    // 创建邀请
    const { data, error } = await supabase
      .from("couple_invitations")
      .insert([{
        inviter_id,
        invitee_id: inviteeData.userId,
        message: message || `用户 ${inviterData.username} 邀请你成为情侣`,
        status: "pending"
      }])
      .select(`*,
    inviter:couple_invitations_inviter_id_fkey(userId, username, avatar_url),
    invitee:couple_invitations_invitee_id_fkey(userId, username, avatar_url)
  `);

    if (error) {
      console.error("创建邀请错误:", error);
      return res.status(500).json({ error: "发送邀请失败" });
    }

    res.status(201).json({
      code: 201,
      message: "邀请发送成功",
      data: data[0]
    });
  } catch (error) {
    console.error("服务器错误:", error.message);
    res.status(500).json({ error: "服务器错误", details: error.message });
  }
});

// 获取用户收到的邀请
router.get("/invitations/received/:userId", async (req, res) => {
  const { userId } = req.params;
  const supabase = req.app.get('supabase');

  try {
    // 验证用户是否存在
    const { data: userData, error: userError } = await supabase
      .from("custom_user")
      .select("userId")
      .eq("userId", userId)
      .single();

    if (userError || !userData) {
      return res.status(400).json({
        error: "用户不存在",
        details: `用户ID ${userId} 在系统中找不到`
      });
    }

    // 获取收到的邀请
    const { data, error } = await supabase
      .from("couple_invitations")
      .select(`*,
        inviter:couple_invitations_inviter_id_fkey(userId, username, avatar_url),
        invitee:couple_invitations_invitee_id_fkey(userId, username, avatar_url)
      `)
      .eq("invitee_id", userId)
      .eq("status", "pending")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("获取邀请错误:", error);
      return res.status(500).json({ error: "获取邀请失败" });
    }

    res.status(200).json({
      code: 200,
      message: "获取邀请成功",
      data: data
    });
  } catch (error) {
    console.error("服务器错误:", error.message);
    res.status(500).json({ error: "服务器错误", details: error.message });
  }
});

// 获取用户发送的邀请
router.get("/invitations/sent/:userId", async (req, res) => {
  const { userId } = req.params;
  const supabase = req.app.get('supabase');

  try {
    // 验证用户是否存在
    const { data: userData, error: userError } = await supabase
      .from("custom_user")
      .select("userId")
      .eq("userId", userId)
      .single();

    if (userError || !userData) {
      return res.status(400).json({
        error: "用户不存在",
        details: `用户ID ${userId} 在系统中找不到`
      });
    }

    // 获取发送的邀请
    const { data, error } = await supabase
      .from("couple_invitations")
      .select(`
        *,
          inviter:couple_invitations_inviter_id_fkey(userId, username, avatar_url),
          invitee:couple_invitations_invitee_id_fkey(userId, username, avatar_url)
      `)
      .eq("inviter_id", userId)
      .eq("status", "pending")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("获取邀请错误:", error);
      return res.status(500).json({ error: "获取邀请失败" });
    }

    res.status(200).json({
      code: 200,
      message: "获取邀请成功",
      data: data
    });
  } catch (error) {
    console.error("服务器错误:", error.message);
    res.status(500).json({ error: "服务器错误", details: error.message });
  }
});

// 回复邀请（接受或拒绝）
router.put("/invitations/:invitationId", async (req, res) => {
  const { invitationId } = req.params;
  const { status, userId } = req.body; // status: accepted 或 rejected
  const supabase = req.app.get('supabase');

  try {
    // 验证用户是否存在
    const { data: userData, error: userError } = await supabase
      .from("custom_user")
      .select("userId")
      .eq("userId", userId)
      .single();

    if (userError || !userData) {
      return res.status(400).json({
        error: "用户不存在",
        details: `用户ID ${userId} 在系统中找不到`
      });
    }

    // 获取邀请信息
    const { data: invitationData, error: invitationError } = await supabase
      .from("couple_invitations")
      .select("*")
      .eq("id", invitationId)
      .single();

    if (invitationError || !invitationData) {
      return res.status(404).json({
        error: "邀请不存在",
        details: `邀请ID ${invitationId} 不存在`
      });
    }

    // 验证是否是邀请的接收者
    if (invitationData.invitee_id !== userId) {
      return res.status(403).json({
        error: "权限不足",
        details: "您无权处理此邀请"
      });
    }

    // 检查邀请状态
    if (invitationData.status !== "pending") {
      return res.status(400).json({
        error: "邀请状态错误",
        details: "该邀请已被处理"
      });
    }

    // 更新邀请状态
    const { data: updatedInvitation, error: updateError } = await supabase
      .from("couple_invitations")
      .update({
        status,
        updated_at: new Date()
      })
      .eq("id", invitationId)
      .select(`
        *,
        inviter:couple_invitations_inviter_id_fkey(userId, username, avatar_url),
        invitee:couple_invitations_invitee_id_fkey(userId, username, avatar_url)
      `);

    if (updateError) {
      console.error("更新邀请状态错误:", updateError);
      return res.status(500).json({ error: "处理邀请失败" });
    }

    // 如果接受邀请，创建情侣关系
    if (status === "accepted") {
      const { data: coupleData, error: coupleError } = await supabase
        .from("couples")
        .insert([
          {
            user1_id: invitationData.inviter_id,
            user2_id: invitationData.invitee_id
          }
        ])
        .select();

      if (coupleError) {
        console.error("创建情侣关系错误:", coupleError);
        // 回滚邀请状态
        await supabase
          .from("couple_invitations")
          .update({ status: "pending" })
          .eq("id", invitationId);

        return res.status(500).json({
          error: "创建情侣关系失败",
          details: coupleError.message
        });
      }

      res.status(200).json({
        code: 200,
        message: "邀请已接受，情侣关系已建立",
        data: {
          invitation: updatedInvitation[0],
          couple: coupleData[0]
        }
      });
    } else {
      res.status(200).json({
        code: 200,
        message: "邀请已拒绝",
        data: updatedInvitation[0]
      });
    }
  } catch (error) {
    console.error("服务器错误:", error.message);
    res.status(500).json({ error: "服务器错误", details: error.message });
  }
});

// 获取情侣关系
router.get("/relationship/:userId", async (req, res) => {
  const { userId } = req.params;
  const supabase = req.app.get('supabase');

  try {
    // 验证用户是否存在
    const { data: userData, error: userError } = await supabase
      .from("custom_user")
      .select("userId")
      .eq("userId", userId)
      .single();

    if (userError || !userData) {
      return res.status(400).json({
        error: "用户不存在",
        details: `用户ID ${userId} 在系统中找不到`
      });
    }

    // 获取情侣关系
    const { data, error } = await supabase
      .from("couples")
      .select(`
        *,
        user1:custom_user(userId, username, avatar_url),
        user2:custom_user(userId, username, avatar_url)
      `)
      .or(`user1_id.eq.${userId},user2_id.eq.${userId}`);

    if (error) {
      console.error("获取情侣关系错误:", error);
      return res.status(500).json({ error: "获取情侣关系失败" });
    }

    if (!data || data.length === 0) {
      return res.status(404).json({
        code: 404,
        message: "未找到情侣关系",
        data: null
      });
    }

    res.status(200).json({
      code: 200,
      message: "获取情侣关系成功",
      data: data[0]
    });
  } catch (error) {
    console.error("服务器错误:", error.message);
    res.status(500).json({ error: "服务器错误", details: error.message });
  }
});

// 删除情侣关系
router.delete("/relationship/:coupleId/:userId", async (req, res) => {
  const { coupleId, userId } = req.params;
  const supabase = req.app.get('supabase');

  try {
    // 验证用户是否存在
    const { data: userData, error: userError } = await supabase
      .from("custom_user")
      .select("userId")
      .eq("userId", userId)
      .single();

    if (userError || !userData) {
      return res.status(400).json({
        error: "用户不存在",
        details: `用户ID ${userId} 在系统中找不到`
      });
    }

    // 验证情侣关系是否存在且用户是其中一员
    const { data: coupleData, error: coupleError } = await supabase
      .from("couples")
      .select("id")
      .eq("id", coupleId)
      .or(`user1_id.eq.${userId},user2_id.eq.${userId}`)
      .single();

    if (coupleError || !coupleData) {
      return res.status(403).json({
        error: "权限不足",
        details: "您无权删除此情侣关系"
      });
    }

    // 删除情侣关系
    const { error: deleteError } = await supabase
      .from("couples")
      .delete()
      .eq("id", coupleId);

    if (deleteError) {
      console.error("删除情侣关系错误:", deleteError);
      return res.status(500).json({ error: "删除情侣关系失败" });
    }

    res.status(200).json({
      code: 200,
      message: "情侣关系已删除"
    });
  } catch (error) {
    console.error("服务器错误:", error.message);
    res.status(500).json({ error: "服务器错误", details: error.message });
  }
});

module.exports = router;