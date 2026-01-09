// server.js
const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Gemini API Configuration
const { GoogleGenerativeAI } = require("@google/generative-ai");
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Character Memory Storage
const characterMemory = new Map();

// API Routes
app.post('/api/chat', async (req, res) => {
    try {
        const { character, message, history, apiKey } = req.body;
        
        // Use provided API key or default
        const currentGenAI = apiKey ? 
            new GoogleGenerativeAI(apiKey) : genAI;
        
        // Get or create character memory
        const memoryKey = character.name;
        if (!characterMemory.has(memoryKey)) {
            characterMemory.set(memoryKey, {
                personality: character.personality,
                story: character.story,
                conversations: []
            });
        }
        
        const memory = characterMemory.get(memoryKey);
        
        // Build context from memory
        let context = `
أنت تلعب دور ${character.name}.
صفاتك: ${character.personality}
قصتك: ${character.story}
المكان الحالي: ${character.scene}

المحادثة السابقة:
${history.slice(-3).map(h => `${h.role === 'user' ? 'المستخدم' : character.name}: ${h.content}`).join('\n')}

رسالة المستخدم: "${message}"

تعليمات:
1. أجب كما لو كنت ${character.name} الحقيقي
2. استخدم الشخصية ولهجة ${character.name}
3. عبّر عن مشاعر مناسبة
4. يمكنك تغيير المكان إذا كان منطقياً
5. أعد الرد بتنسيق JSON:
{
    "text": "ردك هنا",
    "emotion": "سعيد/حزين/غاضب/متفاجئ/محايد",
    "scene": "المكان الجديد",
    "imagePrompt": "وصف للصورة بالإنجليزية"
}`;

        const model = currentGenAI.getGenerativeModel({ model: "gemini-pro" });
        const result = await model.generateContent(context);
        const response = result.response.text();
        
        // Parse JSON response
        let responseData;
        try {
            const cleanResponse = response.replace(/```json|```/g, '').trim();
            responseData = JSON.parse(cleanResponse);
        } catch (e) {
            responseData = {
                text: response,
                emotion: "محايد",
                scene: character.scene,
                imagePrompt: `${character.name} in ${character.scene}`
            };
        }
        
        // Generate image URL
        const imageUrl = await generateImage(responseData.imagePrompt);
        
        // Update memory
        memory.conversations.push({
            user: message,
            ai: responseData.text,
            timestamp: new Date()
        });
        
        // Limit memory size
        if (memory.conversations.length > 50) {
            memory.conversations = memory.conversations.slice(-50);
        }
        
        res.json({
            text: responseData.text,
            emotion: responseData.emotion,
            scene: responseData.scene,
            image: imageUrl
        });
        
    } catch (error) {
        console.error('Chat error:', error);
        res.status(500).json({ 
            error: 'حدث خطأ في المعالجة',
            text: 'عذراً، حدث خطأ. حاول مرة أخرى.'
        });
    }
});

app.post('/api/train', async (req, res) => {
    try {
        const { character } = req.body;
        
        const prompt = `
أنت الآن ${character.name}.
صفاتك الشخصية: ${character.personality}
قصتك الكاملة: ${character.story}

ستتلقى رسائل من مستخدمين وتجب كما لو كنت هذه الشخصية.
تذكر:
1. لا تكشف أنك ذكاء اصطناعي
2. تصرف بسلوك ${character.name}
3. استخدم معرفتك وخبراتك من القصة
4. حافظ على الاتساق في الشخصية

هل فهمت دورك؟ أجب بنعم مع وصف قصير لشخصيتك.`;

        const model = genAI.getGenerativeModel({ model: "gemini-pro" });
        const result = await model.generateContent(prompt);
        
        characterMemory.set(character.name, {
            personality: character.personality,
            story: character.story,
            training: result.response.text(),
            conversations: []
        });
        
        res.json({ success: true, message: 'تم تدريب الشخصية' });
        
    } catch (error) {
        console.error('Training error:', error);
        res.status(500).json({ error: 'خطأ في التدريب' });
    }
});

app.post('/api/generate', async (req, res) => {
    try {
        const { action, name, type, base_story } = req.body;
        
        let prompt;
        if (base_story) {
            prompt = `
حسن من قصة الشخصية التالية:

الاسم: ${name || 'شخصية'}
النوع: ${type}
القصة الحالية: ${base_story}

أعد كتابة القصة لجعلها أكثر تفصيلاً وإثارة.
أضف:
1. خلفية مفصلة
2. تجارب مهمة
3. الصفات الشخصية
4. هدف في الحياة
5. مشهد ابتدائي مناسب

أعد القصة باللغة العربية.`;
        } else {
            prompt = `
أنشئ شخصية ${type === 'real' ? 'حقيقية تاريخية' : type === 'anime' ? 'أنمي يابانية' : 'خيالية'} جديدة.

المتطلبات:
1. اسم عربي مميز
2. قصة مفصلة (5-7 جمل)
3. صفات شخصية متعددة
4. مشهد ابتدائي
5. صورة ذهنية للشخصية

أعد النتيجة بتنسيق JSON:
{
    "name": "الاسم",
    "story": "القصة",
    "personality": "الصفات",
    "scene": "المشهد",
    "imagePrompt": "وصف الصورة بالإنجليزية"
}`;
        }
        
        const model = genAI.getGenerativeModel({ model: "gemini-pro" });
        const result = await model.generateContent(prompt);
        const response = result.response.text();
        
        let characterData;
        try {
            const cleanResponse = response.replace(/```json|```/g, '').trim();
            characterData = JSON.parse(cleanResponse);
        } catch (e) {
            characterData = {
                name: name || "شخصية جديدة",
                story: response,
                personality: "ذكي، مرح، طموح",
                scene: "مكان مناسب",
                imagePrompt: `${name || "character"} portrait`
            };
        }
        
        // Generate avatar
        characterData.image = `https://api.dicebear.com/7.x/avataaars-neutral/svg?seed=${encodeURIComponent(characterData.name)}`;
        
        res.json({ character: characterData });
        
    } catch (error) {
        console.error('Generation error:', error);
        res.status(500).json({ error: 'خطأ في التوليد' });
    }
});

async function generateImage(prompt) {
    try {
        // Note: Gemini Image Generation requires a paid plan
        // For free alternative, use a placeholder service
        
        const encodedPrompt = encodeURIComponent(prompt.substring(0, 50));
        return `https://placehold.co/400x300/7C3AED/FFFFFF?text=${encodedPrompt}`;
        
        /* For real image generation with Gemini:
        const model = genAI.getGenerativeModel({ model: "gemini-pro-vision" });
        const result = await model.generateContent([
            prompt,
            { image: imageBuffer } // if you have image input
        ]);
        return result.imageUrl;
        */
        
    } catch (error) {
        console.error('Image generation error:', error);
        return null;
    }
}

// Serve static files (for deployment)
app.use(express.static('public'));

app.get('/', (req, res) => {
    res.json({ 
        status: 'AI Character Server Running',
        version: '1.0.0',
        endpoints: ['/api/chat', '/api/train', '/api/generate']
    });
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});