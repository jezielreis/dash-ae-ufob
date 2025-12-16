// ConnectionAPI.js - VERSÃO PARA VERCEL (SEM CHAVES EXPOSTAS)

const FieldClimateAPI = {
    baseUrl: "https://api.fieldclimate.com/v2",
    
    // Método principal para fazer requisições
    async request(method, endpoint, data = null, publicKey, privateKey) {
        const timestamp = new Date().toUTCString();
        
        let contentToSign = method + endpoint + timestamp + publicKey;
        
        if (data && method !== "GET") {
            contentToSign += JSON.stringify(data);
        }
        
        const signature = this.calculateSignature(contentToSign, privateKey);
        
        const authHeader = `hmac ${publicKey}:${signature}`;
        
        const headers = {
            "Accept": "application/json",
            "Authorization": authHeader,
            "Request-Date": timestamp,
        };
        
        if (data && method !== "GET") {
            headers["Content-Type"] = "application/json";
        }
        
        const options = {
            method: method,
            headers: headers,
        };
        
        if (data && method !== "GET") {
            options.body = JSON.stringify(data);
        }
        
        const url = this.baseUrl + endpoint;
        
        try {
            const response = await fetch(url, options);
            
            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`HTTP ${response.status}: ${this.sanitizeError(errorText, publicKey, privateKey)}`);
            }
            
            return await response.json();
            
        } catch (error) {
            console.error("Erro na requisição:", error.message);
            throw error;
        }
    },
    
    calculateSignature(content, privateKey) {
        // Esta função será implementada no cliente usando CryptoJS
        // No servidor, usaremos o crypto-js via npm
        throw new Error("Use a API route do servidor para requisições");
    },
    
    // ============================================
    // FUNÇÕES PARA CÁLCULO DE ET0 (apenas lógica)
    // ============================================
    
    extractMeteorologicalParameters(data) {
        const params = {
            temperatura_media: null,
            temperatura_maxima: null,
            temperatura_minima: null,
            umidade_relativa: null,
            radiacao_solar: null,
            velocidade_vento: null,
            pressao_atmosferica: null,
            chuva: null,
            timestamp: new Date().toISOString()
        };
        
        if (data && data.data && Array.isArray(data.data)) {
            const temps = [];
            const humids = [];
            const solar = [];
            const winds = [];
            
            data.data.forEach(entry => {
                if (entry.air_temperature !== undefined) temps.push(entry.air_temperature);
                if (entry.relative_humidity !== undefined) humids.push(entry.relative_humidity);
                if (entry.solar_radiation !== undefined) solar.push(entry.solar_radiation);
                if (entry.wind_speed !== undefined) winds.push(entry.wind_speed);
            });
            
            if (temps.length > 0) {
                params.temperatura_media = temps.reduce((a, b) => a + b) / temps.length;
                params.temperatura_maxima = Math.max(...temps);
                params.temperatura_minima = Math.min(...temps);
            }
            
            if (humids.length > 0) {
                params.umidade_relativa = humids.reduce((a, b) => a + b) / humids.length;
            }
            
            if (solar.length > 0) {
                params.radiacao_solar = solar.reduce((a, b) => a + b) / solar.length;
            }
            
            if (winds.length > 0) {
                params.velocidade_vento = winds.reduce((a, b) => a + b) / winds.length;
            }
        }
        
        return params;
    },
    
    // 7. Penman-Monteith (FAO-56) simplificado
    calculatePenmanMonteithET0(params) {
        const Tmean = params.temperatura_media;
        const RHmean = params.umidade_relativa;
        const Rs = params.radiacao_solar; // W/m²
        const u2 = params.velocidade_vento || 2.0; // m/s, default 2.0
        
        // Constantes
        const albedo = 0.23; // para grama
        const sigma = 4.903e-9; // MJ K⁻⁴ m⁻² day⁻¹
        const Gsc = 0.0820; // MJ m⁻² min⁻¹
        const G = 0; // Fluxo de calor no solo (desprezado para dia)
        
        // 1. Pressão de vapor de saturação (es) e atual (ea)
        const es = 0.6108 * Math.exp((17.27 * Tmean) / (Tmean + 237.3));
        const ea = (RHmean / 100) * es;
        const VPD = es - ea; // Déficit de pressão de vapor
        
        // 2. Declividade da curva de pressão de vapor (Δ)
        const delta = 4098 * es / Math.pow(Tmean + 237.3, 2);
        
        // 3. Pressão atmosférica (P) - estimada
        const altitude = 455; // Jales, SP altitude em metros
        const P = 101.3 * Math.pow((293 - 0.0065 * altitude) / 293, 5.26);
        
        // 4. Constante psicrométrica (γ)
        const gamma = 0.000665 * P;
        
        // 5. Radiação solar em MJ/m²/dia
        const Rs_MJ = Rs * 0.0864; // Converter W/m² para MJ/m²/dia
        
        // 6. Radiação líquida de onda curta (Rns)
        const Rns = (1 - albedo) * Rs_MJ;
        
        // 7. Radiação líquida de onda longa (Rnl) - simplificada
        const Rnl = sigma * Math.pow(Tmean + 273.16, 4) * 
                   (0.34 - 0.14 * Math.sqrt(ea)) * 
                   (1.35 * (Rs_MJ / (0.75 * 24 * Gsc)) - 0.35);
        
        // 8. Radiação líquida total (Rn)
        const Rn = Rns - Rnl;
        
        // 9. ET0 Penman-Monteith FAO-56
        const numerator = 0.408 * delta * (Rn - G) + 
                         gamma * (900 / (Tmean + 273)) * u2 * VPD;
        const denominator = delta + gamma * (1 + 0.34 * u2);
        
        const ET0 = numerator / denominator;
        
        return Math.max(0, ET0);
    },
    
    // 8. Hargreaves com temperatura e radiação solar
    calculateHargreavesET0(Tmax, Tmin, Rs) {
        const Tmean = (Tmax + Tmin) / 2;
        const Ra = Rs * 0.0864; // Converter W/m² para MJ/m²/dia (simplificado)
        
        // Fórmula Hargreaves simplificada
        const ET0 = 0.0023 * Ra * (Tmean + 17.8) * Math.sqrt(Tmax - Tmin);
        
        return ET0;
    },
    
    // 9. Hargreaves apenas com temperatura (quando não tem radiação solar)
    calculateHargreavesTemperatureOnly(Tmax, Tmin) {
        const Tmean = (Tmax + Tmin) / 2;
        const tempRange = Tmax - Tmin;
        
        // Fórmula Hargreaves modificada para falta de radiação
        const Ra_estimated = 15; // MJ/m²/dia
        
        const ET0 = 0.0023 * Ra_estimated * Math.pow(tempRange, 0.674) * (Tmean - 3.5);
        
        return ET0;
    },
    
    // 10. Estimativa simples baseada apenas na temperatura
    estimateET0FromTemperature(Tmean) {
        if (Tmean > 10) {
            return 0.2 * Tmean;
        } else {
            return 0.1 * Tmean;
        }
    },
    
    // 6. Selecionar método de cálculo baseado nos dados disponíveis
    selectET0CalculationMethod(params) {
        const { 
            temperatura_media, 
            temperatura_maxima, 
            temperatura_minima,
            umidade_relativa,
            radiacao_solar,
            velocidade_vento 
        } = params;
        
        let calculationMethod = '';
        let et0Value = null;
        let usedParameters = {};
        
        // MÉTODO 1: Penman-Monteith completo (se tiver todos os dados)
        if (temperatura_media && umidade_relativa && radiacao_solar && velocidade_vento) {
            et0Value = this.calculatePenmanMonteithET0(params);
            calculationMethod = 'penman_monteith_completo';
            usedParameters = {
                temperatura_media,
                umidade_relativa,
                radiacao_solar,
                velocidade_vento
            };
        }
        // MÉTODO 2: Hargreaves com temperatura e radiação
        else if (temperatura_maxima && temperatura_minima && radiacao_solar) {
            et0Value = this.calculateHargreavesET0(
                temperatura_maxima, 
                temperatura_minima, 
                radiacao_solar
            );
            calculationMethod = 'hargreaves_temperatura_radiacao';
            usedParameters = {
                temperatura_maxima,
                temperatura_minima,
                radiacao_solar
            };
        }
        // MÉTODO 3: Hargreaves apenas com temperatura
        else if (temperatura_maxima && temperatura_minima) {
            et0Value = this.calculateHargreavesTemperatureOnly(
                temperatura_maxima, 
                temperatura_minima
            );
            calculationMethod = 'hargreaves_apenas_temperatura';
            usedParameters = {
                temperatura_maxima,
                temperatura_minima
            };
        }
        // MÉTODO 4: Apenas temperatura média (estimativa muito simples)
        else if (temperatura_media) {
            et0Value = this.estimateET0FromTemperature(temperatura_media);
            calculationMethod = 'estimativa_temperatura_media';
            usedParameters = { temperatura_media };
        }
        // MÉTODO 5: Fallback
        else {
            et0Value = 3.5; // Valor médio
            calculationMethod = 'estimativa_padrao';
            usedParameters = {};
        }
        
        // Arredondar e garantir valor positivo
        et0Value = Math.max(0, parseFloat(et0Value.toFixed(1)));
        
        return {
            value: et0Value,
            method: calculationMethod,
            parameters: usedParameters,
            data_quality: this.assessDataQuality(usedParameters)
        };
    },
    
    // 13. Avaliar qualidade dos dados usados
    assessDataQuality(parameters) {
        const paramCount = Object.keys(parameters).length;
        
        if (paramCount >= 4) return 'alta';
        if (paramCount >= 2) return 'media';
        return 'baixa';
    },
    
    sanitizeError(errorText, publicKey, privateKey) {
        return errorText
            .replace(/publicKey=[^&\s]+/g, 'publicKey=[REDACTED]')
            .replace(/privateKey=[^&\s]+/g, 'privateKey=[REDACTED]')
            .replace(/signature=[^&\s]+/g, 'signature=[REDACTED]')
            .replace(/hmac\s+\S+:\S+/g, 'hmac [REDACTED]')
            .replace(publicKey, '[REDACTED]')
            .replace(privateKey, '[REDACTED]');
    }
};

export default FieldClimateAPI;