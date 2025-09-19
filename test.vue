<template>
  <div class="novel-training-container">
    <van-nav-bar
      title="小说训练"
      left-arrow
      @click-left="goBack"
    />
    
    <div class="content">
      <h2 class="title">小说内容训练</h2>
      <p class="description">上传您的小说文本文件，用于AI模型训练和理解</p>
      
      <van-form @submit="onSubmit">
        <van-cell-group inset>
          <van-field
            v-model="formData.title"
            name="title"
            label="小说标题"
            placeholder="请输入小说标题"
            :rules="[{ required: true, message: '请填写小说标题' }]"
          />
          
          <van-field
            v-model="formData.description"
            name="description"
            label="描述"
            type="textarea"
            placeholder="请输入小说简介或描述"
            rows="2"
          />
          
          <van-field name="file" label="小说文件">
            <template #input>
              <van-uploader 
                v-model="fileList" 
                :max-count="1" 
                :before-read="beforeRead"
                :after-read="afterRead"
                accept=".txt"
              />
            </template>
          </van-field>
          
          <div class="file-info" v-if="fileInfo.name">
            <van-cell-group>
              <van-cell title="文件名" :value="fileInfo.name" />
              <van-cell title="文件大小" :value="formatFileSize(fileInfo.size)" />
              <van-cell title="字符数" :value="fileInfo.content.length.toLocaleString()" />
            </van-cell-group>
          </div>
        </van-cell-group>
        
        <div class="submit-button">
          <van-button 
            round 
            block 
            type="primary" 
            native-type="submit"
            :loading="loading"
            :disabled="loading"
          >
            {{ loading ? '训练中...' : '开始训练' }}
          </van-button>
        </div>
      </van-form>
      
      <div class="training-info" v-if="trainingResult">
        <van-divider>训练结果</van-divider>
        <van-cell-group>
          <van-cell title="状态" :value="trainingResult.status" />
          <van-cell 
            title="处理进度" 
            :value="`${trainingResult.progress || 0}%`" 
          />
          <van-cell 
            title="已处理字符数" 
            :value="trainingResult.processedChars ? trainingResult.processedChars.toLocaleString() : '0'" 
          />
          <van-cell 
            title="模型响应" 
            :value="trainingResult.response || '无'" 
          />
        </van-cell-group>
      </div>
      
      <div class="api-info">
        <van-divider>API信息</van-divider>
        <van-cell-group>
          <van-cell title="API提供商" value="DeepSeek" />
          <van-cell title="模型" value="deepseek-chat" />
        </van-cell-group>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { 
  Form as VanForm, 
  Field as VanField, 
  CellGroup as VanCellGroup, 
  Cell as VanCell,
  Button as VanButton,
  Uploader as VanUploader,
  Divider as VanDivider,
  NavBar as VanNavBar
} from 'vant'
import { showSuccessToast, showFailToast } from 'vant'

const router = useRouter()

const formData = ref({
  title: '',
  description: ''
})

const fileList = ref([])
const fileInfo = ref({
  name: '',
  size: 0,
  content: ''
})

const loading = ref(false)
const trainingResult = ref(null)

const goBack = () => {
  router.back()
}

// 文件上传前检查
const beforeRead = (file) => {
  const isTXT = file.type === 'text/plain' || file.name.endsWith('.txt')
  
  if (!isTXT) {
    showFailToast('请上传TXT格式的文本文件')
    return false
  }
  
  // 检查文件大小 (限制为10MB)
  const maxSize = 10 * 1024 * 1024
  if (file.size > maxSize) {
    showFailToast('文件大小不能超过10MB')
    return false
  }
  
  return true
}

// 文件读取完成后处理
const afterRead = (file) => {
  fileInfo.value.name = file.file.name
  fileInfo.value.size = file.file.size
  
  // 读取文件内容
  const reader = new FileReader()
  reader.onload = (e) => {
    fileInfo.value.content = e.target.result
  }
  reader.readAsText(file.file)
}

// 格式化文件大小
const formatFileSize = (size) => {
  if (size < 1024) {
    return size + ' B'
  } else if (size < 1024 * 1024) {
    return (size / 1024).toFixed(2) + ' KB'
  } else if (size < 1024 * 1024 * 1024) {
    return (size / (1024 * 1024)).toFixed(2) + ' MB'
  } else {
    return (size / (1024 * 1024 * 1024)).toFixed(2) + ' GB'
  }
}

// 提交表单
const onSubmit = async (values) => {
  if (!fileInfo.value.content) {
    showFailToast('请先选择要上传的文件')
    return
  }
  
  loading.value = true
  trainingResult.value = {
    status: '准备训练',
    progress: 0,
    processedChars: 0
  }
  
  try {
    // 分块处理大文件，每次发送1000字符
    const chunkSize = 1000
    const content = fileInfo.value.content
    const totalChunks = Math.ceil(content.length / chunkSize)
    
    trainingResult.value.status = '训练中'
    
    for (let i = 0; i < totalChunks; i++) {
      const start = i * chunkSize
      const end = Math.min(start + chunkSize, content.length)
      const chunk = content.substring(start, end)
      
      // 发送到DeepSeek API
      const response = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer sk-cdbb7377fe43423d9d13ff0cc8b18a97'
        },
        body: JSON.stringify({
          model: 'deepseek-chat',
          messages: [
            {
              role: 'system',
              content: '你是一个小说内容分析器，你的任务是理解和学习用户提供的小说内容。请确认收到并分析这些内容。'
            },
            {
              role: 'user',
              content: `小说标题: ${values.title}\n小说描述: ${values.description}\n小说内容片段 (${i+1}/${totalChunks}):\n${chunk}`
            }
          ],
          stream: false
        })
      })
      
      if (!response.ok) {
        throw new Error(`API请求失败: ${response.status} ${response.statusText}`)
      }
      
      const data = await response.json()
      
      // 更新进度
      trainingResult.value.progress = Math.round(((i + 1) / totalChunks) * 100)
      trainingResult.value.processedChars = end
      trainingResult.value.response = data.choices[0].message.content.substring(0, 100) + '...'
      
      // 添加延迟避免请求过于频繁
      await new Promise(resolve => setTimeout(resolve, 500))
    }
    
    trainingResult.value.status = '训练完成'
    showSuccessToast('小说训练完成')
    
  } catch (error) {
    console.error('训练出错:', error)
    trainingResult.value.status = '训练失败'
    showFailToast('训练过程中出现错误: ' + error.message)
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.novel-training-container {
  min-height: 100vh;
  background-color: #f5f7fa;
}

.content {
  padding: 20px;
}

.title {
  text-align: center;
  margin-bottom: 10px;
  color: #333;
}

.description {
  text-align: center;
  margin-bottom: 30px;
  color: #666;
}

.submit-button {
  margin: 30px 0;
}

.file-info {
  margin-top: 20px;
}

.training-info {
  margin-top: 30px;
}

.api-info {
  margin-top: 30px;
}
</style>