// api/fieldclimate.js - Serverless function para Vercel
const CryptoJS = require('crypto-js');

export default async function handler(req, res) {
    // Configurações da API (variáveis de ambiente)
    const PUBLIC_KEY = process.env.FIELDCLIMATE_PUBLIC_KEY;
    const PRIVATE_KEY = process.env.FIELDCLIMATE_PRIVATE_KEY;
    
    // Verificar se as variáveis de ambiente estão configuradas
    if (!PUBLIC_KEY || !PRIVATE_KEY) {
        console.error('Variáveis de ambiente não configuradas');
        return res.status(500).json({ 
            error: 'Configuração incompleta',
            message: 'As credenciais da API não foram configuradas. Verifique as variáveis de ambiente no Vercel.'
        });
    }
    
    const BASE_URL = 'https://api.fieldclimate.com/v2';
    
    // Configuração CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    
    // Lidar com preflight requests
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    
    // Verificar método HTTP permitido
    if (!['GET', 'POST'].includes(req.method)) {
        return res.status(405).json({ error: 'Método não permitido' });
    }
    
    // Extrair o endpoint da query string
    const { endpoint } = req.query;
    
    if (!endpoint) {
        return res.status(400).json({ error: 'Endpoint não especificado' });
    }
    
    // Validar endpoint para segurança
    if (!endpoint.startsWith('/') || endpoint.includes('..')) {
        return res.status(400).json({ error: 'Endpoint inválido' });
    }
    
    // Método HTTP
    const method = req.method;
    
    // Timestamp para assinatura
    const timestamp = new Date().toUTCString();
    
    try {
        // Construir conteúdo para assinatura
        let contentToSign = method + endpoint + timestamp + PUBLIC_KEY;
        
        if (req.body && Object.keys(req.body).length > 0 && method !== 'GET') {
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
        
        // Fazer requisição para a API FieldClimate
        const response = await fetch(url, options);
        
        // Verificar se a resposta é OK
        if (!response.ok) {
            const errorText = await response.text();
            console.error('Erro na API FieldClimate:', response.status);
            
            // Não retornar erros detalhados da API externa
            return res.status(500).json({ 
                error: 'Erro ao buscar dados da estação',
                status: response.status
            });
        }
        
        // Obter dados da resposta
        const data = await response.json();
        
        // Sanitizar dados (remover informações sensíveis)
        sanitizeData(data);
        
        // Retornar dados
        return res.status(200).json(data);
        
    } catch (error) {
        console.error('Erro no proxy:', error.message);
        return res.status(500).json({ 
            error: 'Erro interno do servidor',
            message: error.message 
        });
    }
}

// Função para sanitizar dados (remover informações sensíveis)
function sanitizeData(data) {
    if (!data || typeof data !== 'object') return;
    
    const sensitiveKeys = [
        'api_keys', 'private_keys', 'tokens', 'secret_keys', 
        'api_key', 'private_key', 'password', 'secret', 
        'access_token', 'refresh_token', 'signature'
    ];
    
    const removeSensitiveKeys = (obj) => {
        if (!obj || typeof obj !== 'object') return;
        
        for (const key of sensitiveKeys) {
            delete obj[key];
        }
        
        // Recursivamente limpar objetos aninhados
        for (let key in obj) {
            if (obj[key] && typeof obj[key] === 'object') {
                removeSensitiveKeys(obj[key]);
            }
        }
    };
    
    removeSensitiveKeys(data);
}
