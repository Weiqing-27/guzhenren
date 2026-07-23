-- 软考 · 信息系统项目管理师 复习模块

-- 题库
CREATE TABLE IF NOT EXISTS ruankao_questions (
  id SERIAL PRIMARY KEY,
  subject VARCHAR(50) NOT NULL DEFAULT '综合知识',
  chapter VARCHAR(100) NOT NULL DEFAULT '',
  qtype VARCHAR(20) NOT NULL DEFAULT 'single', -- single | multi
  stem TEXT NOT NULL,
  options JSONB NOT NULL DEFAULT '[]'::jsonb,
  answer VARCHAR(20) NOT NULL,
  explanation TEXT DEFAULT '',
  difficulty VARCHAR(20) NOT NULL DEFAULT 'medium', -- easy | medium | hard
  tags TEXT[] DEFAULT '{}',
  external_id VARCHAR(120) UNIQUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ruankao_questions_subject ON ruankao_questions(subject);
CREATE INDEX IF NOT EXISTS idx_ruankao_questions_chapter ON ruankao_questions(chapter);
CREATE INDEX IF NOT EXISTS idx_ruankao_questions_difficulty ON ruankao_questions(difficulty);

-- 答题记录
CREATE TABLE IF NOT EXISTS ruankao_attempts (
  id SERIAL PRIMARY KEY,
  user_id UUID NOT NULL,
  question_id INTEGER NOT NULL REFERENCES ruankao_questions(id) ON DELETE CASCADE,
  user_answer VARCHAR(50) NOT NULL,
  is_correct BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ruankao_attempts_user ON ruankao_attempts(user_id);
CREATE INDEX IF NOT EXISTS idx_ruankao_attempts_question ON ruankao_attempts(question_id);
CREATE INDEX IF NOT EXISTS idx_ruankao_attempts_user_created ON ruankao_attempts(user_id, created_at DESC);

-- 错题本
CREATE TABLE IF NOT EXISTS ruankao_wrong_book (
  id SERIAL PRIMARY KEY,
  user_id UUID NOT NULL,
  question_id INTEGER NOT NULL REFERENCES ruankao_questions(id) ON DELETE CASCADE,
  wrong_count INTEGER NOT NULL DEFAULT 1,
  last_wrong_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  mastered BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE (user_id, question_id)
);

CREATE INDEX IF NOT EXISTS idx_ruankao_wrong_book_user ON ruankao_wrong_book(user_id);
CREATE INDEX IF NOT EXISTS idx_ruankao_wrong_book_mastered ON ruankao_wrong_book(user_id, mastered);

-- 每日打卡
CREATE TABLE IF NOT EXISTS ruankao_checkins (
  id SERIAL PRIMARY KEY,
  user_id UUID NOT NULL,
  checkin_date DATE NOT NULL,
  study_minutes INTEGER NOT NULL DEFAULT 0,
  note TEXT DEFAULT '',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE (user_id, checkin_date)
);

CREATE INDEX IF NOT EXISTS idx_ruankao_checkins_user_date ON ruankao_checkins(user_id, checkin_date DESC);

-- 学习笔记
CREATE TABLE IF NOT EXISTS ruankao_notes (
  id SERIAL PRIMARY KEY,
  user_id UUID NOT NULL,
  title VARCHAR(200) NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  category VARCHAR(50) NOT NULL DEFAULT '综合',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ruankao_notes_user ON ruankao_notes(user_id);
CREATE INDEX IF NOT EXISTS idx_ruankao_notes_category ON ruankao_notes(user_id, category);

-- 知识卡片（公共只读 + 可扩展）
CREATE TABLE IF NOT EXISTS ruankao_knowledge (
  id SERIAL PRIMARY KEY,
  category VARCHAR(50) NOT NULL DEFAULT 'ITTO',
  title VARCHAR(200) NOT NULL,
  content TEXT NOT NULL,
  keywords TEXT[] DEFAULT '{}',
  sort_order INTEGER NOT NULL DEFAULT 0,
  external_id VARCHAR(120) UNIQUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ruankao_knowledge_category ON ruankao_knowledge(category);

-- 种子题（可重复执行：仅当表为空时插入）
INSERT INTO ruankao_questions (subject, chapter, qtype, stem, options, answer, explanation, difficulty, tags)
SELECT * FROM (VALUES
  (
    '综合知识',
    '项目整体管理',
    'single',
    '项目章程通常由谁批准发布？',
    '[{"key":"A","text":"项目经理"},{"key":"B","text":"项目发起人或出资人"},{"key":"C","text":"PMO"},{"key":"D","text":"客户代表"}]'::jsonb,
    'B',
    '项目章程由发起人或出资人批准，赋予项目经理动用组织资源的权力。',
    'easy',
    ARRAY['章程','整体管理']
  ),
  (
    '综合知识',
    '范围管理',
    'single',
    '以下哪项属于范围基准的组成部分？',
    '[{"key":"A","text":"项目章程、WBS、WBS词典"},{"key":"B","text":"范围管理计划、需求文件、范围说明书"},{"key":"C","text":"项目范围说明书、WBS、WBS词典"},{"key":"D","text":"需求跟踪矩阵、WBS、活动清单"}]'::jsonb,
    'C',
    '范围基准包括：批准的项目范围说明书、WBS 和相应的 WBS 词典。',
    'medium',
    ARRAY['范围基准','WBS']
  ),
  (
    '综合知识',
    '进度管理',
    'single',
    '关键路径法（CPM）中，总浮动时间为零的活动通常表示：',
    '[{"key":"A","text":"可以任意推迟"},{"key":"B","text":"位于关键路径上"},{"key":"C","text":"资源冲突最严重"},{"key":"D","text":"必须使用关键链法"}]'::jsonb,
    'B',
    '关键路径上活动总浮动通常为 0（或最小），延迟会影响项目完成日期。',
    'easy',
    ARRAY['关键路径','浮动时间']
  ),
  (
    '综合知识',
    '成本管理',
    'single',
    '某项目 EV=80、PV=100、AC=90，则成本绩效指数 CPI 与进度绩效指数 SPI 分别为：',
    '[{"key":"A","text":"CPI=0.89，SPI=0.80"},{"key":"B","text":"CPI=0.80，SPI=0.89"},{"key":"C","text":"CPI=1.13，SPI=1.25"},{"key":"D","text":"CPI=1.25，SPI=1.13"}]'::jsonb,
    'A',
    'CPI=EV/AC=80/90≈0.89；SPI=EV/PV=80/100=0.80。成本和进度均落后。',
    'medium',
    ARRAY['挣值','CPI','SPI']
  ),
  (
    '综合知识',
    '风险管理',
    'single',
    '定性风险分析的主要输出是：',
    '[{"key":"A","text":"风险登记册更新（优先级排序）"},{"key":"B","text":"应急储备金额"},{"key":"C","text":"定量风险模型"},{"key":"D","text":"风险审计报告"}]'::jsonb,
    'A',
    '定性风险分析对已识别风险进行优先级排序，主要更新风险登记册。',
    'medium',
    ARRAY['风险','定性分析']
  ),
  (
    '综合知识',
    '质量管理',
    'single',
    '质量控制与质量保证的区别，下列说法正确的是：',
    '[{"key":"A","text":"质量控制关注过程改进，质量保证关注可交付成果检查"},{"key":"B","text":"质量控制关注可交付成果是否符合标准，质量保证关注过程是否被正确执行"},{"key":"C","text":"二者完全相同"},{"key":"D","text":"质量控制只在收尾阶段执行"}]'::jsonb,
    'B',
    'QA 偏过程与体系保证；QC 偏检查可交付成果是否满足质量要求。',
    'medium',
    ARRAY['质量保证','质量控制']
  ),
  (
    '综合知识',
    '采购管理',
    'single',
    '固定总价合同最适合的情形是：',
    '[{"key":"A","text":"范围不清晰且变更频繁"},{"key":"B","text":"范围明确、需求稳定"},{"key":"C","text":"买方希望供应商承担最少风险"},{"key":"D","text":"只能用于研发类项目"}]'::jsonb,
    'B',
    '固定总价要求范围清晰，卖方承担成本超支风险，适合需求稳定的采购。',
    'easy',
    ARRAY['合同','采购']
  ),
  (
    '综合知识',
    '沟通管理',
    'single',
    '项目中潜在沟通渠道数量的计算公式是（n 为干系人数量）：',
    '[{"key":"A","text":"n(n+1)/2"},{"key":"B","text":"n(n-1)/2"},{"key":"C","text":"2n-1"},{"key":"D","text":"n^2"}]'::jsonb,
    'B',
    '沟通渠道数 = n(n-1)/2。',
    'easy',
    ARRAY['沟通渠道']
  ),
  (
    '案例分析',
    '进度与成本',
    'single',
    '案例中若 SPI<1 且 CPI<1，项目经理应优先关注：',
    '[{"key":"A","text":"仅压缩成本"},{"key":"B","text":"进度落后且成本超支，需综合赶工/快速跟进并控成本"},{"key":"C","text":"忽略进度只做质量审计"},{"key":"D","text":"立即终止项目"}]'::jsonb,
    'B',
    '双重落后时需结合赶工、快速跟进、范围/资源调整，并控制成本与风险。',
    'hard',
    ARRAY['案例','挣值']
  ),
  (
    '综合知识',
    '敏捷与数字化',
    'single',
    '关于敏捷项目中产品负责人（Product Owner）的职责，正确的是：',
    '[{"key":"A","text":"负责团队日常站会主持并分配编程任务"},{"key":"B","text":"维护产品待办列表，明确优先级与验收标准"},{"key":"C","text":"只负责编写测试用例"},{"key":"D","text":"不参与需求澄清"}]'::jsonb,
    'B',
    'PO 对产品价值负责，管理 Product Backlog 与优先级。',
    'medium',
    ARRAY['敏捷','PO']
  )
) AS v(subject, chapter, qtype, stem, options, answer, explanation, difficulty, tags)
WHERE NOT EXISTS (SELECT 1 FROM ruankao_questions LIMIT 1);

-- 种子知识卡片
INSERT INTO ruankao_knowledge (category, title, content, keywords, sort_order)
SELECT * FROM (VALUES
  (
    'ITTO',
    '制定项目章程 · 主要输入/工具/输出',
    '输入：商业文件、协议、事业环境因素、组织过程资产。工具：专家判断、数据收集、人际关系与团队技能、会议。输出：项目章程、假设日志。',
    ARRAY['章程','ITTO'],
    1
  ),
  (
    'ITTO',
    '制定范围管理计划 · 要点',
    '范围管理计划说明如何定义、监督、控制和确认范围；需求管理计划说明如何分析、记录和管理需求。二者都是规划过程组输出。',
    ARRAY['范围','需求'],
    2
  ),
  (
    '计算',
    '挣值核心公式速记',
    'CV=EV-AC；SV=EV-PV；CPI=EV/AC；SPI=EV/PV；EAC=BAC/CPI（典型）；ETC=EAC-AC；VAC=BAC-EAC。',
    ARRAY['挣值','公式'],
    3
  ),
  (
    '计算',
    '三点估算（PERT）',
    '期望值 Te=(To+4Tm+Tp)/6；标准差 σ=(Tp-To)/6。常用于活动历时估算。',
    ARRAY['PERT','三点估算'],
    4
  ),
  (
    '论文',
    '论文通用结构',
    '摘要 → 背景与目标 → 过程（结合十大管理选 3～4 个过程展开）→ 问题与解决 → 效果与总结。每个过程写清：做什么、用什么、结果如何。',
    ARRAY['论文','结构'],
    5
  ),
  (
    '论文',
    '可复用项目背景要素',
    '写清：行业背景、建设目标、你的角色与职责、团队规模、工期与预算、技术架构要点、主要干系人。考前准备 2～3 套可裁剪背景。',
    ARRAY['论文','背景'],
    6
  ),
  (
    '案例',
    '案例分析答题框架',
    '1) 定位问题（对照过程/技术）2) 分析原因 3) 给出可落地措施 4) 必要时补充预防措施。计算题单独列步骤，单位与公式写全。',
    ARRAY['案例','答题'],
    7
  ),
  (
    '十大管理',
    '十大知识领域速览',
    '整合、范围、进度、成本、质量、资源、沟通、风险、采购、干系人。记忆时结合过程组：启动/规划/执行/监控/收尾。',
    ARRAY['十大管理'],
    8
  )
) AS v(category, title, content, keywords, sort_order)
WHERE NOT EXISTS (SELECT 1 FROM ruankao_knowledge LIMIT 1);
