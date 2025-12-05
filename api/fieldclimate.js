// api/fieldclimate.js - Serverless function para Vercel
const CryptoJS = require('crypto-js');

export default async function handler(req, res) {
    // Configurações da API (variáveis de ambiente)
    const PUBLIC_KEY = process.env.FIELDCLIMATE_PUBLIC_KEY;
    const PRIVATE_KEY = process.env.FIELDCLIMATE_PRIVATE_KEY;
    const BASE_URL = 'https://api.fieldclimate.com/v2';
    
    // Configuração CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    
    // Lidar com preflight requests
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    
    // Extrair o endpoint da query string
    const { endpoint } = req.query;
    
    if (!endpoint) {
        return res.status(400).json({ error: 'Endpoint não especificado' });
    }
    
    // Método HTTP
    const method = req.method;
    
    // Timestamp para assinatura
    const timestamp = new Date().toUTCString();
    
    // Construir conteúdo para assinatura
    let contentToSign = method + endpoint + timestamp + PUBLIC_KEY;
    
    if (req.body && method !== 'GET') {
        contentToSign += JSON.stringify(req.body);
    }
    
    // Gerar assinatura HMAC
    const signature = CryptoJS.HmacSHA256(contentToSign, PRIVATE_KEY)
        .toString(CryptoJS.enc.Hex);
    
    const authHeader = `hmac ${PUBLIC_KEY}:${signature}`;
    
    // Headers para a requisição
    const headers = {
        "Accept": "application/json",
        "Authorization": authHeader,
        "Request-Date": timestamp,
    };
    
    if (req.body && method !== 'GET') {
        headers["Content-Type"] = "application/json";
    }
    
    // URL completa
    const url = BASE_URL + endpoint;
    
    // Opções para fetch
    const options = {
        method: method,
        headers: headers,
    };
    
    if (req.body && method !== 'GET') {
        options.body = JSON.stringify(req.body);
    }
    
    try {
        // Fazer requisição para a API FieldClimate
        const response = await fetch(url, options);
        
        // Verificar se a resposta é OK
        if (!response.ok) {
            const errorText = await response.text();
            console.error('Erro na API FieldClimate:', response.status, errorText);
            return res.status(response.status).json({ 
                error: `Erro ${response.status}: ${errorText.substring(0, 100)}` 
            });
        }
        
        // Obter dados da resposta
        const data = await response.json();
        
        // Sanitizar dados (remover informações sensíveis)
        sanitizeData(data);
        
        // Retornar dados
        return res.status(200).json(data);
        
    } catch (error) {
        console.error('Erro no proxy:', error);
        return res.status(500).json({ 
            error: 'Erro interno do servidor',
            message: error.message 
        });
    }
}

// Função para sanitizar dados (remover informações sensíveis)
function sanitizeData(data) {
    if (!data) return;
    
    // Remover chaves sensíveis de objetos aninhados
    const removeSensitiveKeys = (obj) => {
        if (!obj || typeof obj !== 'object') return;
        
        delete obj.api_keys;
        delete obj.private_keys;
        delete obj.tokens;
        delete obj.secret_keys;
        delete obj.api_key;
        delete obj.private_key;
        delete obj.password;
        
        // Recursivamente limpar objetos aninhados
        for (let key in obj) {
            if (typeof obj[key] === 'object') {
                removeSensitiveKeys(obj[key]);
            }
        }
    };
    
    removeSensitiveKeys(data);
}