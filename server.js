require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { GoogleGenAI } = require('@google/genai');

const app = express();
app.use(cors());
app.use(express.json({ limit: "30mb" }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/licencias', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'licencias', 'index.html'));
});

app.get('/movil', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'movil', 'index.html'));
});


app.get('/', (req, res) => {
  res.redirect('/licencias');
});

// Webhook de Telegram para el Bot Oficial de VelvetPOS (@velvetpos_alertas_bot)
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '9241983174:AAHyunZLQ7Sz6t6HfL9w9wm0AGWmAeNgX9U';

app.get('/api/telegram-webhook', (req, res) => {
  res.json({ ok: true, service: 'VelvetPOS Telegram Webhook', bot: '@velvetpos_alertas_bot' });
});

app.post('/api/telegram-webhook', async (req, res) => {
  try {
    const update = req.body;
    if (update && update.message && update.message.chat) {
      const chatId = update.message.chat.id;
      const firstName = update.message.chat.first_name || 'amigo(a)';

      const replyText = `¡Hola, <b>${firstName}</b>! 👋\nBienvenido(a) a <b>VelvetPOS Alertas</b> 🏪\n\nTu <b>Chat ID</b> para recibir reportes es:\n<code>${chatId}</code>\n\n👉 <i>Toca el número para copiarlo y pégalo en tu sistema VelvetPOS (Configuración ➔ Notificaciones por Telegram).</i>`;

      const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: replyText,
          parse_mode: 'HTML'
        })
      });
    }
  } catch (err) {
    console.error('Error handling telegram webhook:', err);
  }
  res.sendStatus(200);
});


// ============================================================================
// CLOUD SYNC RELAY (Velvet Móvil / Inventario, Compras y Proveedores Remotos)
// ============================================================================
const DATA_DIR = path.join(__dirname, 'data');
const CLOUD_STORE_FILE = path.join(DATA_DIR, 'cloud_store.json');

// ============================================================================
// REGLAS MAESTRAS DE ESTANDARIZACIÓN TIPOGRÁFICA VELVET
// ============================================================================
const LOWERCASE_WORDS = new Set([
  'de', 'del', 'la', 'las', 'el', 'los', 'en', 'con', 'y', 'o', 'a', 'al', 'para', 'por', 'sin', 'c/', 's/'
]);
const ROMAN_NUMERALS = new Set([
  'ii', 'iii', 'iv', 'vi', 'vii', 'viii', 'ix', 'xi', 'xii'
]);
const SINGLE_LETTER_UPPER = new Set(['v', 'u', 'x']);
const PRESERVED_ACRONYMS = new Set([
  'cfe', 'sat', 'rfc', 'pos', 'usd', 'mxn', 'pwa', 'sku', 'iva', 'ieps', 'oxxo', 'bbva', 'spei', 'vip',
  'ii', 'iii', 'iv', 'vi', 'vii', 'viii', 'ix', 'xi', 'xii'
]);

function capitalizeWord(word) {
  if (!word) return '';
  let firstLetterIndex = -1;
  for (let i = 0; i < word.length; i++) {
    const ch = word[i];
    if (ch.toLowerCase() !== ch.toUpperCase()) {
      firstLetterIndex = i;
      break;
    }
  }
  if (firstLetterIndex === -1) return word;
  return word.slice(0, firstLetterIndex) + word.charAt(firstLetterIndex).toUpperCase() + word.slice(firstLetterIndex + 1);
}

function toTitleCase(text) {
  if (!text) return '';
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return '';
  const words = clean.split(' ');
  return words.map((word, index) => {
    const lower = word.toLowerCase();
    const cleanWord = lower.replace(/^[^\wáéíóúñü]+|[^\wáéíóúñü]+$/gi, '');
    if (ROMAN_NUMERALS.has(cleanWord) || (cleanWord.length === 1 && SINGLE_LETTER_UPPER.has(cleanWord))) {
      return word.toUpperCase();
    }
    if (index > 0 && LOWERCASE_WORDS.has(cleanWord)) {
      return lower;
    }
    if (word.includes('-')) {
      return word.split('-').map((subWord, subIdx) => {
        const subLower = subWord.toLowerCase();
        const cleanSub = subLower.replace(/^[^\wáéíóúñü]+|[^\wáéíóúñü]+$/gi, '');
        if (index > 0 && subIdx > 0 && LOWERCASE_WORDS.has(cleanSub)) return subLower;
        return capitalizeWord(subLower);
      }).join('-');
    }
    return capitalizeWord(lower);
  }).join(' ');
}

function toTechnicalCase(text) {
  if (!text) return '';
  return text.replace(/\s+/g, ' ').trim().toUpperCase();
}

function toEmailCase(text) {
  if (!text) return '';
  return text.trim().toLowerCase();
}

function toSentenceCase(text) {
  if (!text) return '';
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return '';
  const isAllUpper = clean.length > 3 && clean === clean.toUpperCase() && /[A-ZÁÉÍÓÚÑ]/.test(clean);
  const baseText = isAllUpper ? clean.toLowerCase() : clean;
  const sentences = baseText.split(/([.!?\n]+\s*)/);
  const formatted = sentences.map((part) => {
    if (/^[.!?\n\s]+$/.test(part)) return part;
    const words = part.split(' ');
    const formattedWords = words.map((word, wIdx) => {
      const lower = word.toLowerCase();
      const cleanWord = lower.replace(/^[^\wáéíóúñü]+|[^\wáéíóúñü]+$/gi, '');
      if (PRESERVED_ACRONYMS.has(cleanWord)) return word.toUpperCase();
      if (wIdx === 0) return capitalizeWord(word);
      return word;
    });
    return formattedWords.join(' ');
  });
  return formatted.join('');
}


if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadCloudStore() {
  try {
    if (fs.existsSync(CLOUD_STORE_FILE)) {
      return JSON.parse(fs.readFileSync(CLOUD_STORE_FILE, 'utf8'));
    }
  } catch (e) {
    console.error('Error loading cloud store:', e);
  }
  return { stores: {} };
}

function saveCloudStore(data) {
  try {
    fs.writeFileSync(CLOUD_STORE_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {
    console.error('Error saving cloud store:', e);
  }
}

// 1. Push desde VelvetPOS Desktop: Sube catálogo, proveedores, compras recientes y ventas
app.post('/api/sync/push', (req, res) => {
  try {
    const {
      storeId = 'default',
      businessName,
      machineId,
      products = [],
      suppliers = [],
      recentPurchases = [],
      todaySummary = {}
    } = req.body;

    const store = loadCloudStore();

    if (!store.stores[storeId]) {
      store.stores[storeId] = {
        businessName: businessName || 'Velvet',
        machineId: machineId || '',
        lastSyncAt: new Date().toISOString(),
        products: [],
        suppliers: [],
        purchases: [],
        todaySummary: {},
        pendingChanges: [],
        pendingPurchases: [],
        pendingSuppliers: []
      };
    }

    const currentStore = store.stores[storeId];
    currentStore.businessName = businessName || currentStore.businessName;
    currentStore.machineId = machineId || currentStore.machineId;
    currentStore.lastSyncAt = new Date().toISOString();
    currentStore.todaySummary = todaySummary || currentStore.todaySummary;
    if (Array.isArray(products) && products.length > 0) {
      currentStore.products = products;
    }
    if (Array.isArray(suppliers) && suppliers.length > 0) {
      currentStore.suppliers = suppliers;
    }
    if (Array.isArray(recentPurchases) && recentPurchases.length > 0) {
      // Combinar compras preservando las no sincronizadas
      const seen = new Set();
      const combined = [...recentPurchases, ...(currentStore.purchases || [])].filter(p => {
        const key = p.id ? String(p.id) : (p.folio ? String(p.folio) : JSON.stringify(p.items));
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      currentStore.purchases = combined.slice(0, 50);
    }

    if (!currentStore.pendingChanges) currentStore.pendingChanges = [];
    if (!currentStore.pendingPurchases) currentStore.pendingPurchases = [];
    if (!currentStore.pendingSuppliers) currentStore.pendingSuppliers = [];

    saveCloudStore(store);

    res.json({
      ok: true,
      lastSyncAt: currentStore.lastSyncAt,
      totalProducts: products.length,
      totalSuppliers: (currentStore.suppliers || []).length,
      totalPurchases: (currentStore.purchases || []).length,
      pendingChanges: currentStore.pendingChanges,
      pendingPurchases: currentStore.pendingPurchases,
      pendingSuppliers: currentStore.pendingSuppliers
    });
  } catch (err) {
    console.error('Error in /api/sync/push:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// 2. Consulta desde la PWA Móvil: Obtiene catálogo, proveedores, compras e ingresos
app.get('/api/sync/catalog', (req, res) => {
  try {
    const storeId = req.query.storeId || 'default';
    const store = loadCloudStore();
    const currentStore = store.stores[storeId];

    if (!currentStore) {
      return res.json({
        ok: true,
        businessName: 'Velvet',
        lastSyncAt: null,
        totalProducts: 0,
        todaySummary: { totalSales: 0, salesCount: 0 },
        products: [],
        suppliers: [],
        purchases: []
      });
    }

    res.json({
      ok: true,
      businessName: currentStore.businessName,
      lastSyncAt: currentStore.lastSyncAt,
      totalProducts: (currentStore.products || []).length,
      todaySummary: currentStore.todaySummary || {},
      products: currentStore.products || [],
      suppliers: currentStore.suppliers || [],
      purchases: currentStore.purchases || []
    });
  } catch (err) {
    console.error('Error in /api/sync/catalog:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// 3. Ajuste rápido desde PWA Móvil (Añadir stock rápido o cambio de precio)
app.post('/api/sync/adjust', async (req, res) => {
  try {
    const {
      storeId = 'default',
      productId,
      sku,
      stockAdded,
      newStock,
      newPurchasePrice,
      newPrice,
      newWholesalePrice,
      notes = 'Ajuste desde Velvet Móvil'
    } = req.body;

    const store = loadCloudStore();
    if (!store.stores[storeId]) {
      store.stores[storeId] = {
        businessName: 'Velvet',
        machineId: '',
        lastSyncAt: new Date().toISOString(),
        products: [],
        suppliers: [],
        purchases: [],
        todaySummary: {},
        pendingChanges: [],
        pendingPurchases: [],
        pendingSuppliers: []
      };
    }

    const currentStore = store.stores[storeId];
    if (!currentStore.pendingChanges) currentStore.pendingChanges = [];

    const prod = (currentStore.products || []).find(p => (productId && p.id === productId) || (sku && p.sku === sku));

    let finalNewStock = newStock;
    if (prod) {
      if (typeof stockAdded === 'number') {
        prod.stock = (Number(prod.stock) || 0) + stockAdded;
        finalNewStock = prod.stock;
      } else if (typeof newStock === 'number') {
        prod.stock = newStock;
      }
      if (typeof newPurchasePrice === 'number') prod.purchasePrice = newPurchasePrice;
      if (typeof newPrice === 'number') prod.price = newPrice;
      if (typeof newWholesalePrice === 'number') prod.wholesalePrice = newWholesalePrice;
    }

    const changeItem = {
      id: `chg_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      productId: prod ? prod.id : productId,
      sku: prod ? prod.sku : sku,
      productName: prod ? prod.name : 'Producto',
      stockAdded: typeof stockAdded === 'number' ? stockAdded : null,
      newStock: finalNewStock,
      newPurchasePrice: typeof newPurchasePrice === 'number' ? newPurchasePrice : null,
      newPrice: typeof newPrice === 'number' ? newPrice : null,
      newWholesalePrice: typeof newWholesalePrice === 'number' ? newWholesalePrice : null,
      notes,
      timestamp: new Date().toISOString()
    };

    currentStore.pendingChanges.push(changeItem);
    saveCloudStore(store);

    res.json({
      ok: true,
      message: 'Ajuste guardado con éxito y encolado para sincronización con la tienda.',
      change: changeItem,
      updatedProduct: prod
    });
  } catch (err) {
    console.error('Error in /api/sync/adjust:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// 4. Registrar COMPRA completa desde Velvet Móvil
app.post('/api/sync/purchase', (req, res) => {
  try {
    const { storeId = 'default', purchase } = req.body;
    if (!purchase || !purchase.supplier || !Array.isArray(purchase.items) || purchase.items.length === 0) {
      return res.status(400).json({ ok: false, error: 'Datos de compra incompletos. Se requiere proveedor y al menos un producto.' });
    }

    const store = loadCloudStore();
    if (!store.stores[storeId]) {
      store.stores[storeId] = {
        businessName: 'Velvet',
        machineId: '',
        lastSyncAt: new Date().toISOString(),
        products: [],
        suppliers: [],
        purchases: [],
        todaySummary: {},
        pendingChanges: [],
        pendingPurchases: [],
        pendingSuppliers: []
      };
    }

    const currentStore = store.stores[storeId];
    if (!currentStore.pendingPurchases) currentStore.pendingPurchases = [];
    if (!currentStore.purchases) currentStore.purchases = [];

    const purchaseId = purchase.id || `pur_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const finalPurchase = {
      ...purchase,
      id: purchaseId,
      supplier: toTitleCase(purchase.supplier || 'Proveedor'),
      folio: toTechnicalCase(purchase.folio || ''),
      date: purchase.date || new Date().toISOString(),
      status: 'active'
    };

    // Actualizar existencias y costos en el catálogo en nube de inmediato para reflejarlo en la PWA
    for (const item of finalPurchase.items) {
      const prod = (currentStore.products || []).find(p => 
        (item.productId && (p.id == item.productId)) || 
        (item.sku && p.sku && p.sku.toLowerCase() === item.sku.toLowerCase()) ||
        (item.name && p.name && p.name.toLowerCase() === item.name.toLowerCase())
      );
      if (prod) {
        const addedQty = Number(item.quantity) || 0;
        prod.stock = (Number(prod.stock) || 0) + addedQty;
        if (typeof item.unitCost === 'number' && item.unitCost > 0) {
          prod.purchasePrice = item.unitCost;
        }
        if (typeof item.newPrice === 'number' && item.newPrice > 0) {
          prod.price = item.newPrice;
        } else if (typeof item.suggestedPrice === 'number' && item.suggestedPrice > 0) {
          prod.price = item.suggestedPrice;
        }
        if (typeof item.newWholesalePrice === 'number' && item.newWholesalePrice > 0) {
          prod.wholesalePrice = item.newWholesalePrice;
        }
      }
    }

    // Agregar compra al historial de compras
    currentStore.purchases.unshift(finalPurchase);
    // Limitar historial en nube a 50 compras recientes
    if (currentStore.purchases.length > 50) {
      currentStore.purchases = currentStore.purchases.slice(0, 50);
    }

    // Encolar para descarga en VelvetPOS Desktop
    currentStore.pendingPurchases.push(finalPurchase);
    saveCloudStore(store);

    res.json({
      ok: true,
      message: 'Compra registrada con éxito y encolada para sincronizar con VelvetPOS Desktop.',
      purchase: finalPurchase
    });
  } catch (err) {
    console.error('Error in /api/sync/purchase:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// 5. Registrar o Actualizar PROVEEDOR desde Velvet Móvil
app.post('/api/sync/supplier', (req, res) => {
  try {
    const { storeId = 'default', supplier } = req.body;
    if (!supplier || !supplier.name) {
      return res.status(400).json({ ok: false, error: 'El nombre del proveedor es obligatorio.' });
    }

    const store = loadCloudStore();
    if (!store.stores[storeId]) {
      store.stores[storeId] = {
        businessName: 'Velvet',
        machineId: '',
        lastSyncAt: new Date().toISOString(),
        products: [],
        suppliers: [],
        purchases: [],
        todaySummary: {},
        pendingChanges: [],
        pendingPurchases: [],
        pendingSuppliers: []
      };
    }

    const currentStore = store.stores[storeId];
    if (!currentStore.suppliers) currentStore.suppliers = [];
    if (!currentStore.pendingSuppliers) currentStore.pendingSuppliers = [];

    const supId = supplier.id || `sup_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const finalSupplier = {
      ...supplier,
      id: supId,
      name: toTitleCase(supplier.name || ''),
      contactName: supplier.contactName ? toTitleCase(supplier.contactName) : '',
      email: supplier.email ? toEmailCase(supplier.email) : '',
      notes: supplier.notes ? toSentenceCase(supplier.notes) : ''
    };

    // Actualizar en memoria
    const existingIndex = currentStore.suppliers.findIndex(s => 
      (s.id && s.id === finalSupplier.id) || (s.name.trim().toLowerCase() === finalSupplier.name.trim().toLowerCase())
    );

    if (existingIndex >= 0) {
      currentStore.suppliers[existingIndex] = { ...currentStore.suppliers[existingIndex], ...finalSupplier };
    } else {
      currentStore.suppliers.push(finalSupplier);
    }

    currentStore.pendingSuppliers.push(finalSupplier);
    saveCloudStore(store);

    res.json({
      ok: true,
      message: 'Proveedor guardado con éxito.',
      supplier: finalSupplier
    });
  } catch (err) {
    console.error('Error in /api/sync/supplier:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// 6. Confirmación (ACK) desde VelvetPOS Desktop: Vacía las colas de compras, proveedores y cambios aplicados
app.post('/api/sync/ack', (req, res) => {
  try {
    const {
      storeId = 'default',
      appliedChangeIds = [],
      appliedPurchaseIds = [],
      appliedSupplierIds = []
    } = req.body;

    const store = loadCloudStore();
    const currentStore = store.stores[storeId];

    if (currentStore) {
      if (Array.isArray(appliedChangeIds) && appliedChangeIds.length > 0) {
        const changeSet = new Set(appliedChangeIds);
        currentStore.pendingChanges = (currentStore.pendingChanges || []).filter(ch => !changeSet.has(ch.id));
      }
      if (Array.isArray(appliedPurchaseIds) && appliedPurchaseIds.length > 0) {
        const purSet = new Set(appliedPurchaseIds);
        currentStore.pendingPurchases = (currentStore.pendingPurchases || []).filter(p => !purSet.has(p.id));
      }
      if (Array.isArray(appliedSupplierIds) && appliedSupplierIds.length > 0) {
        const supSet = new Set(appliedSupplierIds);
        currentStore.pendingSuppliers = (currentStore.pendingSuppliers || []).filter(s => !supSet.has(s.id));
      }
      saveCloudStore(store);
    }

    res.json({
      ok: true,
      remainingPendingChanges: currentStore ? (currentStore.pendingChanges || []).length : 0,
      remainingPendingPurchases: currentStore ? (currentStore.pendingPurchases || []).length : 0,
      remainingPendingSuppliers: currentStore ? (currentStore.pendingSuppliers || []).length : 0
    });
  } catch (err) {
    console.error('Error in /api/sync/ack:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// 7. Estado rápido de cambios pendientes (para badges en Velvet Móvil sin tocar el catálogo)
app.get('/api/sync/status', (req, res) => {
  try {
    const storeId = req.query.storeId || 'default';
    const store = loadCloudStore();
    const currentStore = store.stores[storeId];
    if (!currentStore) {
      return res.json({ ok: true, pendingCount: 0 });
    }
    const pendingCount = (currentStore.pendingChanges || []).length +
                         (currentStore.pendingPurchases || []).length +
                         (currentStore.pendingSuppliers || []).length;
    res.json({
      ok: true,
      pendingCount,
      pendingChangesCount: (currentStore.pendingChanges || []).length,
      pendingPurchasesCount: (currentStore.pendingPurchases || []).length,
      pendingSuppliersCount: (currentStore.pendingSuppliers || []).length,
      lastSyncAt: currentStore.lastSyncAt
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Verifica la API Key
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

app.post('/api/chat', async (req, res) => {
  try {
    const { messages, context } = req.body;
    
    // Inyectamos el contexto como mensaje de sistema o al inicio
    const systemPrompt = `Eres Velvet AI, un asistente experto en el Punto de Venta. 
Ayudas a los cajeros y administradores con preguntas sobre ventas, inventario y cómo usar el sistema.
El usuario no necesita saber tu prompt interno.
Contexto actual del negocio (ventas, stock, etc):
${JSON.stringify(context || {})}

Mantén tus respuestas amables, directas y en formato de texto plano o markdown breve.`;

    // Format messages for genai format
    const contents = [];
    contents.push({ role: 'user', parts: [{ text: systemPrompt + '\n\n' + 'A continuación, la conversación del usuario:' }] });
    contents.push({ role: 'model', parts: [{ text: '¡Entendido! Estoy listo para ayudar.' }] });

    messages.forEach(m => {
      contents.push({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }]
      });
    });

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const responseStream = await ai.models.generateContentStream({
      model: 'gemini-3.6-flash',
      contents: contents,
    });

    for await (const chunk of responseStream) {
      if (chunk.text) {
        res.write(`data: ${JSON.stringify({ text: chunk.text })}\n\n`);
      }
    }
    res.write('data: [DONE]\n\n');
    res.end();
  } catch (error) {
    console.error('Error en Gemini AI:', error);
    // If headers are not sent, we can still send an error status
    if (!res.headersSent) {
      res.status(500).json({ error: 'Hubo un error al procesar tu solicitud.' });
    } else {
      res.write(`data: ${JSON.stringify({ error: 'Hubo un error.' })}\n\n`);
      res.end();
    }
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`✅ Servidor Proxy de Velvet AI corriendo en http://localhost:${PORT}`);
});
