import CryptoJS from 'crypto-js';

// Configuração específica para a estação 031133E8
const TARGET_STATION_ID = '031133E8';

const FieldClimateAPI = {
    baseUrl: "https://api.fieldclimate.com/v2",
    
    async request(method, endpoint, data = null, publicKey, privateKey) {
        const timestamp = new Date().toUTCString();
        
        let contentToSign = method + endpoint + timestamp + publicKey;
        
        if (data && method !== "GET") {
            contentToSign += JSON.stringify(data);
        }
        
        const signature = CryptoJS.HmacSHA256(contentToSign, privateKey)
            .toString(CryptoJS.enc.Hex);
        
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
    
    // Métodos de cálculo de ET0
    extractMeteorologicalParameters(data) {
        const params = {
            temperatura_media: null,
            temperatura_maxima: null,
            temperatura_minima: null,
            umidade_relativa: null,
            radiacao_solar: null,
            velocidade_vento: null,
            chuva: null
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
    
    calculatePenmanMonteithET0(params) {
        const Tmean = params.temperatura_media;
        const RHmean = params.umidade_relativa;
        const Rs = params.radiacao_solar;
        const u2 = params.velocidade_vento || 2.0;
        
        // Pressão de vapor
        const es = 0.6108 * Math.exp((17.27 * Tmean) / (Tmean + 237.3));
        const ea = (RHmean / 100) * es;
        const VPD = es - ea;
        
        // Declividade da curva de pressão de vapor
        const delta = 4098 * es / Math.pow(Tmean + 237.3, 2);
        
        // Constante psicrométrica
        const gamma = 0.665 * 0.001 * 101.3;
        
        // Radiação solar em MJ/m²/dia
        const Rs_MJ = Rs * 0.0864;
        
        // Radiação líquida (simplificada)
        const Rns = (1 - 0.23) * Rs_MJ;
        const Rnl = 4.903e-9 * Math.pow(Tmean + 273.16, 4) * 
                   (0.34 - 0.14 * Math.sqrt(ea)) * 
                   (1.35 * (Rs_MJ / (0.75 * 24 * 0.0820)) - 0.35);
        const Rn = Rns - Rnl;
        const G = 0;
        
        // ET0 Penman-Monteith FAO-56 simplificado
        const numerator = 0.408 * delta * (Rn - G) + 
                         gamma * (900 / (Tmean + 273)) * u2 * VPD;
        const denominator = delta + gamma * (1 + 0.34 * u2);
        
        const ET0 = numerator / denominator;
        
        return Math.max(0, ET0);
    },
    
    calculateHargreavesET0(Tmax, Tmin, Rs) {
        const Tmean = (Tmax + Tmin) / 2;
        const Ra = Rs * 0.0864;
        const ET0 = 0.0023 * Ra * (Tmean + 17.8) * Math.sqrt(Tmax - Tmin);
        return ET0;
    },
    
    calculateHargreavesTemperatureOnly(Tmax, Tmin) {
        const Tmean = (Tmax + Tmin) / 2;
        const tempRange = Tmax - Tmin;
        const Ra_estimated = 15;
        const ET0 = 0.0023 * Ra_estimated * Math.pow(tempRange, 0.674) * (Tmean - 3.5);
        return ET0;
    },
    
    estimateET0FromTemperature(Tmean) {
        if (Tmean > 10) {
            return 0.2 * Tmean;
        } else {
            return 0.1 * Tmean;
        }
    },
    
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
        
        if (temperatura_media && umidade_relativa && radiacao_solar && velocidade_vento) {
            et0Value = this.calculatePenmanMonteithET0(params);
            calculationMethod = 'penman_monteith_completo';
            usedParameters = {
                temperatura_media: temperatura_media.toFixed(1),
                umidade_relativa: umidade_relativa.toFixed(0),
                radiacao_solar: radiacao_solar.toFixed(0),
                velocidade_vento: velocidade_vento.toFixed(1)
            };
        }
        else if (temperatura_maxima && temperatura_minima && radiacao_solar) {
            et0Value = this.calculateHargreavesET0(
                temperatura_maxima, 
                temperatura_minima, 
                radiacao_solar
            );
            calculationMethod = 'hargreaves_temperatura_radiacao';
            usedParameters = {
                temperatura_maxima: temperatura_maxima.toFixed(1),
                temperatura_minima: temperatura_minima.toFixed(1),
                radiacao_solar: radiacao_solar.toFixed(0)
            };
        }
        else if (temperatura_maxima && temperatura_minima) {
            et0Value = this.calculateHargreavesTemperatureOnly(
                temperatura_maxima, 
                temperatura_minima
            );
            calculationMethod = 'hargreaves_apenas_temperatura';
            usedParameters = {
                temperatura_maxima: temperatura_maxima.toFixed(1),
                temperatura_minima: temperatura_minima.toFixed(1)
            };
        }
        else if (temperatura_media) {
            et0Value = this.estimateET0FromTemperature(temperatura_media);
            calculationMethod = 'estimativa_temperatura_media';
            usedParameters = { 
                temperatura_media: temperatura_media.toFixed(1)
            };
        }
        else {
            et0Value = 3.5;
            calculationMethod = 'estimativa_padrao';
            usedParameters = {};
        }
        
        et0Value = Math.max(0, parseFloat(et0Value.toFixed(1)));
        
        return {
            value: et0Value,
            method: calculationMethod,
            parameters: usedParameters,
            data_quality: this.assessDataQuality(usedParameters)
        };
    },
    
    assessDataQuality(parameters) {
        const paramCount = Object.keys(parameters).length;
        if (paramCount >= 4) return 'alta';
        if (paramCount >= 2) return 'media';
        if (paramCount >= 1) return 'baixa';
        return 'muito_baixa';
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

// Funções auxiliares que usam a API
async function testConnection(publicKey, privateKey) {
  try {
    const stationInfo = await FieldClimateAPI.request('GET', `/station/${TARGET_STATION_ID}`, null, publicKey, privateKey);
    return {
      success: true,
      message: "Conexão estabelecida com sucesso",
      stationsCount: 1
    };
  } catch (error) {
    return {
      success: false,
      message: "Falha na conexão. Verifique suas credenciais."
    };
  }
}

async function getUserInfo(publicKey, privateKey) {
  try {
    const userInfo = await FieldClimateAPI.request('GET', '/user', null, publicKey, privateKey);
    return {
      success: true,
      stations_count: 1,
      message: "Usuário autenticado com sucesso - Estação 031133E8"
    };
  } catch (error) {
    return {
      success: false,
      message: "Não foi possível verificar informações do usuário"
    };
  }
}

async function getStations(publicKey, privateKey) {
  try {
    const stationInfo = await FieldClimateAPI.request('GET', `/station/${TARGET_STATION_ID}`, null, publicKey, privateKey);
    
    // Limpar dados sensíveis
    const { api_keys, private_keys, tokens, ...safeStation } = stationInfo;
    
    // Retornar como array com único elemento
    return [{
      ...safeStation,
      name: {
        original: TARGET_STATION_ID,
        custom: stationInfo.name || 'Estação Meteorológica UFOB'
      }
    }];
  } catch (error) {
    console.error('Erro ao buscar estação:', error);
    return [];
  }
}

async function getStationInfo(stationId, publicKey, privateKey) {
  // Sempre retorna a estação alvo
  const info = await FieldClimateAPI.request('GET', `/station/${TARGET_STATION_ID}`, null, publicKey, privateKey);
  delete info?.api_keys;
  delete info?.private_keys;
  delete info?.tokens;
  return info;
}

async function getStationLastData(stationId, hoursBack, publicKey, privateKey) {
  const now = new Date();
  const past = new Date(now.getTime() - (hoursBack * 60 * 60 * 1000));
  
  const formatDate = (date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${year}${month}${day}${hours}${minutes}`;
  };
  
  const from = formatDate(past);
  const to = formatDate(now);
  
  return await FieldClimateAPI.request('GET', `/data/${TARGET_STATION_ID}/data/${from}/${to}`, null, publicKey, privateKey);
}

async function calculateET0(stationId, date, publicKey, privateKey) {
  try {
    // Obter dados da estação específica
    const stationData = await getStationLastData(TARGET_STATION_ID, 24, publicKey, privateKey);
    
    // Extrair parâmetros
    const params = FieldClimateAPI.extractMeteorologicalParameters(stationData);
    
    // Calcular ET0 baseado nos parâmetros disponíveis
    const et0Result = FieldClimateAPI.selectET0CalculationMethod(params);
    
    return {
      success: true,
      data: {
        value: et0Result.value,
        unit: 'mm/dia',
        date: date || new Date().toISOString().split('T')[0],
        calculated: true,
        method: et0Result.method,
        parameters: et0Result.parameters,
        data_quality: et0Result.data_quality
      }
    };
  } catch (error) {
    console.error('Erro no cálculo de ET0:', error);
    
    // Fallback final
    const month = new Date().getMonth();
    let defaultET0;
    
    if (month >= 9 || month <= 2) {
      defaultET0 = 4.5;
    } else if (month >= 3 && month <= 5) {
      defaultET0 = 3.0;
    } else {
      defaultET0 = 2.5;
    }
    
    return {
      success: true,
      data: {
        value: defaultET0,
        unit: 'mm/dia',
        date: date || new Date().toISOString().split('T')[0],
        calculated: true,
        method: 'estimativa_sazonal',
        parameters: {
          mes_do_ano: month + 1,
          regiao: 'sudeste_brasil',
          fonte: 'media_sazonal'
        },
        data_quality: 'muito_baixa',
        note: 'Valor estimado baseado na média sazonal da região'
      }
    };
  }
}

// Cache para dados da estação (em memória)
let stationDataCache = {
  timestamp: null,
  data: null,
  et0: null
};

// Função para obter dados com cache de 1 hora + 15 minutos (75 minutos)
async function getCachedStationData(publicKey, privateKey) {
  const CACHE_DURATION = 75 * 60 * 1000; // 75 minutos em milissegundos
  const now = Date.now();
  
  // Verificar se o cache é válido
  if (stationDataCache.data && 
      stationDataCache.timestamp && 
      (now - stationDataCache.timestamp) < CACHE_DURATION) {
    console.log('📦 Retornando dados do cache');
    return stationDataCache.data;
  }
  
  console.log('🔄 Atualizando dados da estação (cache expirado)');
  
  try {
    // Buscar dados atualizados
    const stationInfo = await FieldClimateAPI.request('GET', `/station/${TARGET_STATION_ID}`, null, publicKey, privateKey);
    const lastData = await getStationLastData(TARGET_STATION_ID, 24, publicKey, privateKey);
    
    // Calcular ET0
    const params = FieldClimateAPI.extractMeteorologicalParameters(lastData);
    const et0Result = FieldClimateAPI.selectET0CalculationMethod(params);
    
    // Preparar dados formatados
    const formattedData = {
      station: {
        ...stationInfo,
        name: {
          original: TARGET_STATION_ID,
          custom: stationInfo.name || 'Estação Meteorológica UFOB'
        }
      },
      lastData: lastData,
      et0: et0Result,
      timestamp: now,
      nextUpdate: now + CACHE_DURATION
    };
    
    // Atualizar cache
    stationDataCache = {
      timestamp: now,
      data: formattedData,
      et0: et0Result
    };
    
    return formattedData;
    
  } catch (error) {
    console.error('Erro ao atualizar dados:', error);
    // Retornar cache mesmo expirado em caso de erro
    return stationDataCache.data;
  }
}

export default async function handler(req, res) {
  // Configuração de CORS
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  // Se for preflight request
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  try {
    const { 
      action,
      stationId,
      method = 'GET',
      hoursBack = 24,
      date,
      ...params 
    } = req.body;

    // Validar que apenas a estação alvo é acessada
    if (stationId && stationId !== TARGET_STATION_ID) {
      return res.status(403).json({
        success: false,
        message: 'Acesso permitido apenas à estação autorizada'
      });
    }

    // Obter chaves das variáveis de ambiente
    const publicKey = process.env.FIELDCLIMATE_PUBLIC_KEY;
    const privateKey = process.env.FIELDCLIMATE_PRIVATE_KEY;

    if (!publicKey || !privateKey) {
      return res.status(500).json({ 
        success: false, 
        message: 'Chaves da API não configuradas no servidor.' 
      });
    }

    let result;

    switch (action) {
      case 'testConnection':
        result = await testConnection(publicKey, privateKey);
        break;
      
      case 'getUserInfo':
        result = await getUserInfo(publicKey, privateKey);
        break;
      
      case 'getStations':
        // Usar cache para estações
        const cachedData = await getCachedStationData(publicKey, privateKey);
        result = cachedData ? [cachedData.station] : [];
        break;
      
      case 'getStationInfo':
        const cached = await getCachedStationData(publicKey, privateKey);
        result = cached ? cached.station : null;
        break;
      
      case 'getStationLastData':
        const cacheData = await getCachedStationData(publicKey, privateKey);
        result = cacheData ? cacheData.lastData : null;
        break;
      
      case 'getCachedData':
        // Nova ação para obter dados completos do cache
        const fullCache = await getCachedStationData(publicKey, privateKey);
        result = fullCache || {
          success: false,
          message: 'Nenhum dado em cache disponível'
        };
        break;
      
      case 'calculateET0':
        const et0Cache = await getCachedStationData(publicKey, privateKey);
        if (et0Cache && et0Cache.et0) {
          result = {
            success: true,
            data: {
              ...et0Cache.et0,
              value: et0Cache.et0.value,
              unit: 'mm/dia',
              date: date || new Date().toISOString().split('T')[0],
              calculated: true
            }
          };
        } else {
          // Calcular se não tiver em cache
          result = await calculateET0(TARGET_STATION_ID, date, publicKey, privateKey);
        }
        break;
      
      case 'forceRefresh':
        // Forçar atualização do cache
        stationDataCache = { timestamp: null, data: null, et0: null };
        const refreshedData = await getCachedStationData(publicKey, privateKey);
        result = {
          success: true,
          message: 'Cache atualizado com sucesso',
          data: refreshedData
        };
        break;
      
      default:
        throw new Error(`Ação não suportada: ${action}`);
    }

    res.status(200).json(result);
  } catch (error) {
    console.error('Erro na API route:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Erro interno do servidor'
    });
  }
}