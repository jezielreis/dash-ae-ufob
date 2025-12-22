import CryptoJS from 'crypto-js';

// ============================================
// ET0 CALCULATOR (FAO-56) - Corrigido e Otimizado
// ============================================

class ET0Calculator {
    static REGION_PARAMS = {
        '031133E8': {
            latitude: -12.15,
            longitude: -45.00,
            altitude: 400,
            timezone: -3
        }
    };

    static calculatePenmanMonteithFAO56(params, stationInfo) {
        const {
            temperatura_maxima,
            temperatura_minima,
            umidade_relativa_max,
            umidade_relativa_min,
            umidade_relativa_med,
            radiacao_solar,
            velocidade_vento_2m,
            pressao_atmosferica
        } = params;

        const {
            latitude,
            altitude = 400,
            julianDay = this.getJulianDay()
        } = stationInfo;

        const Tmean = (temperatura_maxima + temperatura_minima) / 2;
        
        const es_max = 0.6108 * Math.exp((17.27 * temperatura_maxima) / (temperatura_maxima + 237.3));
        const es_min = 0.6108 * Math.exp((17.27 * temperatura_minima) / (temperatura_minima + 237.3));
        const es = (es_max + es_min) / 2;
        
        let ea;
        if (umidade_relativa_max && umidade_relativa_min) {
            ea = (es_min * (umidade_relativa_max / 100) + es_max * (umidade_relativa_min / 100)) / 2;
        } else if (umidade_relativa_med) {
            ea = es * (umidade_relativa_med / 100);
        } else {
            ea = es * 0.70;
        }
        
        const VPD = es - ea;
        const delta = (4098 * es) / Math.pow(Tmean + 237.3, 2);
        const P = pressao_atmosferica || this.calculateAtmosphericPressure(altitude);
        const gamma = 0.000665 * P;
        
        const Rn = this.calculateNetRadiation(
            radiacao_solar, 
            Tmean, 
            ea, 
            latitude, 
            altitude,
            julianDay
        );
        
        const G = 0;
        const u2 = velocidade_vento_2m || 2.0;
        
        const numerador = (0.408 * delta * (Rn - G)) + 
                         (gamma * (900 / (Tmean + 273)) * u2 * VPD);
        const denominador = delta + (gamma * (1 + 0.34 * u2));
        
        const ET0 = numerador / denominador;
        
        return Math.max(0, ET0);
    }

    static calculateHargreavesSamani(Tmax, Tmin, latitude, julianDay) {
        const Tmean = (Tmax + Tmin) / 2;
        const TR = Tmax - Tmin;
        
        const Ra = this.calculateExtraterrestrialRadiation(latitude, julianDay);
        const kRs = 0.19;
        const ET0 = 0.0023 * (Tmean + 17.8) * Math.sqrt(TR) * Ra * kRs;
        
        return Math.max(0, ET0);
    }

    static calculatePriestleyTaylor(Tmean, Rn) {
        const es = 0.6108 * Math.exp((17.27 * Tmean) / (Tmean + 237.3));
        const delta = (4098 * es) / Math.pow(Tmean + 237.3, 2);
        const gamma = 0.066;
        const alpha = 1.26;
        const ET0 = alpha * (delta / (delta + gamma)) * (Rn / 2.45);
        
        return Math.max(0, ET0);
    }

    static calculateExtraterrestrialRadiation(latitude, julianDay) {
        const phi = latitude * (Math.PI / 180);
        const delta = 0.409 * Math.sin((2 * Math.PI * julianDay / 365) - 1.39);
        const dr = 1 + 0.033 * Math.cos(2 * Math.PI * julianDay / 365);
        const omega_s = Math.acos(-Math.tan(phi) * Math.tan(delta));
        const Gsc = 0.0820;
        const Ra = (24 * 60 / Math.PI) * Gsc * dr * 
                   (omega_s * Math.sin(phi) * Math.sin(delta) + 
                    Math.cos(phi) * Math.cos(delta) * Math.sin(omega_s));
        
        return Ra;
    }

    static calculateNetRadiation(Rs, Tmean, ea, latitude, altitude, julianDay) {
        const albedo = 0.23;
        const Rns = (1 - albedo) * Rs;
        const sigma = 4.903e-9;
        const Tmax_k = Tmean + 10 + 273.16;
        const Tmin_k = Tmean - 10 + 273.16;
        
        const Rso = this.calculateClearSkyRadiation(latitude, altitude, julianDay);
        const Rs_Rso = Math.min(Rs / Rso, 1.0);
        const cloudFactor = 1.35 * Rs_Rso - 0.35;
        
        const Rnl = sigma * ((Math.pow(Tmax_k, 4) + Math.pow(Tmin_k, 4)) / 2) * 
                    (0.34 - 0.14 * Math.sqrt(ea)) * cloudFactor;
        
        const Rn = Rns - Rnl;
        
        return Math.max(0, Rn);
    }

    static calculateClearSkyRadiation(latitude, altitude, julianDay) {
        const Ra = this.calculateExtraterrestrialRadiation(latitude, julianDay);
        const transmissionFactor = 0.75 + (2e-5 * altitude);
        return Ra * transmissionFactor;
    }

    static calculateAtmosphericPressure(altitude) {
        const P0 = 101.3;
        const tempK0 = 293;
        const g = 9.807;
        const M = 0.0289644;
        const R = 8.31447;
        
        const P = P0 * Math.pow((tempK0 - (0.0065 * altitude)) / tempK0, 
                               (g * M) / (R * 0.0065));
        
        return P;
    }

    static convertSolarRadiationToDaily(solarRadiationW) {
        return (solarRadiationW * 0.0864);
    }

    static getJulianDay(date = new Date()) {
        const start = new Date(date.getFullYear(), 0, 0);
        const diff = date - start;
        const oneDay = 1000 * 60 * 60 * 24;
        return Math.floor(diff / oneDay);
    }

    static selectBestMethod(params, stationId) {
        const {
            temperatura_maxima,
            temperatura_minima,
            umidade_relativa_med,
            radiacao_solar,
            velocidade_vento_2m
        } = params;

        let method = '';
        let et0Value = 0;
        let quality = 'muito_baixa';
        let usedParams = {};

        const stationInfo = this.REGION_PARAMS[stationId] || {
            latitude: -12.15,
            altitude: 400,
            timezone: -3
        };

        // MÉTODO 1: Penman-Monteith FAO-56 Completo
        if (temperatura_maxima && temperatura_minima && radiacao_solar && umidade_relativa_med && velocidade_vento_2m) {
            try {
                let Rs_MJ = radiacao_solar;
                if (radiacao_solar > 1000) {
                    Rs_MJ = this.convertSolarRadiationToDaily(radiacao_solar);
                }
                
                const et0Params = {
                    temperatura_maxima,
                    temperatura_minima,
                    umidade_relativa_med,
                    radiacao_solar: Rs_MJ,
                    velocidade_vento_2m
                };
                
                et0Value = this.calculatePenmanMonteithFAO56(et0Params, stationInfo);
                method = 'penman_monteith_fao56';
                quality = 'alta';
                
                usedParams = {
                    temperatura_maxima: temperatura_maxima.toFixed(1),
                    temperatura_minima: temperatura_minima.toFixed(1),
                    umidade_relativa: umidade_relativa_med.toFixed(0),
                    radiacao_solar: Rs_MJ.toFixed(2),
                    velocidade_vento: velocidade_vento_2m.toFixed(1)
                };
                
            } catch (error) {
                console.error('Erro no método Penman-Monteith:', error);
            }
        }

        // MÉTODO 2: Hargreaves-Samani
        if ((method === '' || quality === 'muito_baixa') && 
            temperatura_maxima && temperatura_minima) {
            try {
                const julianDay = this.getJulianDay();
                et0Value = this.calculateHargreavesSamani(
                    temperatura_maxima, 
                    temperatura_minima, 
                    stationInfo.latitude,
                    julianDay
                );
                method = 'hargreaves_samani';
                quality = 'media';
                
                usedParams = {
                    temperatura_maxima: temperatura_maxima.toFixed(1),
                    temperatura_minima: temperatura_minima.toFixed(1),
                    latitude: stationInfo.latitude.toFixed(2)
                };
                
            } catch (error) {
                console.error('Erro no método Hargreaves-Samani:', error);
            }
        }

        // MÉTODO 3: Priestley-Taylor
        if ((method === '' || quality === 'muito_baixa') && 
            temperatura_maxima && temperatura_minima && radiacao_solar) {
            try {
                const Tmean = (temperatura_maxima + temperatura_minima) / 2;
                let Rs_MJ = radiacao_solar;
                if (radiacao_solar > 1000) {
                    Rs_MJ = this.convertSolarRadiationToDaily(radiacao_solar);
                }
                
                const Rn = Rs_MJ * 0.77;
                et0Value = this.calculatePriestleyTaylor(Tmean, Rn);
                method = 'priestley_taylor';
                quality = 'media';
                
                usedParams = {
                    temperatura_media: Tmean.toFixed(1),
                    radiacao_solar: Rs_MJ.toFixed(2)
                };
                
            } catch (error) {
                console.error('Erro no método Priestley-Taylor:', error);
            }
        }

        // MÉTODO 4: Estimativa por temperatura
        if (method === '' || quality === 'muito_baixa') {
            const Tmean = temperatura_maxima && temperatura_minima ? 
                         (temperatura_maxima + temperatura_minima) / 2 : 
                         25;
            
            et0Value = 0.3 * Tmean;
            method = 'estimativa_temperatura';
            quality = 'baixa';
            
            usedParams = {
                temperatura_estimada: Tmean.toFixed(1),
                regiao: 'oeste_bahia'
            };
        }

        return {
            value: Math.max(0, parseFloat(et0Value.toFixed(2))),
            method,
            quality,
            parameters: usedParams
        };
    }
}

// ============================================
// FIELDCLIMATE API (Integrada com ET0 Calculator)
// ============================================

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
    
    extractMeteorologicalParameters(data) {
        const params = {
            temperatura_media: null,
            temperatura_maxima: null,
            temperatura_minima: null,
            umidade_relativa_med: null,
            radiacao_solar: null,
            velocidade_vento_2m: null,
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
                params.umidade_relativa_med = humids.reduce((a, b) => a + b) / humids.length;
            }
            
            if (solar.length > 0) {
                params.radiacao_solar = solar.reduce((a, b) => a + b) / solar.length;
            }
            
            if (winds.length > 0) {
                params.velocidade_vento_2m = winds.reduce((a, b) => a + b) / winds.length;
            }
        }
        
        return params;
    },
    
    /*calculateET0Adaptive(params, stationId) {
        return ET0Calculator.selectBestMethod(params, stationId);
    },*/
    
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

// ============================================
// FUNÇÕES AUXILIARES
// ============================================

async function testConnection(publicKey, privateKey) {
  try {
    const stations = await FieldClimateAPI.request('GET', '/user/stations', null, publicKey, privateKey);
    return {
      success: true,
      message: "Conexão estabelecida com sucesso",
      stationsCount: Array.isArray(stations) ? stations.length : 1
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
      stations_count: userInfo.stations_count || 0,
      message: "Usuário autenticado com sucesso"
    };
  } catch (error) {
    return {
      success: false,
      message: "Não foi possível verificar informações do usuário"
    };
  }
}

async function getStations(publicKey, privateKey) {
  const stations = await FieldClimateAPI.request('GET', '/user/stations', null, publicKey, privateKey);
  return stations.map(station => {
    const { api_keys, private_keys, tokens, ...safeStation } = station;
    return safeStation;
  });
}

async function getStationInfo(stationId, publicKey, privateKey) {
  const info = await FieldClimateAPI.request('GET', `/station/${stationId}`, null, publicKey, privateKey);
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
  
  return await FieldClimateAPI.request('GET', `/data/${stationId}/data/${from}/${to}`, null, publicKey, privateKey);
}

/*async function calculateET0(stationId, date, publicKey, privateKey) {
  try {
    // Obter dados da estação
    const stationData = await getStationLastData(stationId, 24, publicKey, privateKey);
    
    // Extrair parâmetros
    const params = FieldClimateAPI.extractMeteorologicalParameters(stationData);
    
    // Calcular ET0 usando método adaptativo
    const et0Result = FieldClimateAPI.calculateET0Adaptive(params, stationId);
    
    return {
      success: true,
      data: {
        value: et0Result.value,
        unit: 'mm/dia',
        date: date || new Date().toISOString().split('T')[0],
        calculated: true,
        method: et0Result.method,
        parameters: et0Result.parameters,
        data_quality: et0Result.quality
      }
    };
  } catch (error) {
    console.error('Erro no cálculo de ET0:', error);
    
    // Fallback para estimativa sazonal
    const month = new Date().getMonth();
    let defaultET0;
    
    if (month >= 9 || month <= 2) {
      defaultET0 = 4.5;  // Verão/Outono - maior evapotranspiração
    } else if (month >= 3 && month <= 5) {
      defaultET0 = 3.0;  // Outono/Inverno
    } else {
      defaultET0 = 2.5;  // Inverno/Primavera
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
          regiao: 'oeste_bahia',
          fonte: 'media_sazonal'
        },
        data_quality: 'baixa',
        note: 'Valor estimado baseado na média sazonal da região Oeste da Bahia'
      }
    };
  }
}*/

// LOCAL EXATO: Substituir a função calculateET0 existente

async function calculateET0(stationId, date, publicKey, privateKey) {
    try {
        // Obter dados da estação
        const stationData = await getStationLastData(stationId, 24, publicKey, privateKey);
        
        // Extrair parâmetros
        const params = FieldClimateAPI.extractMeteorologicalParameters(stationData);
        
        // IMPORTAR E USAR ET0Calculator
        const ET0Calculator = (await import('./et0-calculator.js')).default;
        
        const stationInfo = ET0Calculator.REGION_PARAMS[stationId] || {
            latitude: -12.15,
            altitude: 400,
            timezone: -3,
            id: stationId
        };
        
        // Chamar selectBestMethod de forma assíncrona
        const et0Result = await ET0Calculator.selectBestMethod(params, stationInfo);
        
        return {
            success: true,
            data: {
                value: et0Result.value,
                unit: 'mm/dia',
                date: date || new Date().toISOString().split('T')[0],
                calculated: true,
                method: et0Result.method,
                parameters: et0Result.parameters,
                data_quality: et0Result.quality,
                note: et0Result.note || '',
                source: et0Result.source || 'calculated'
            }
        };
    } catch (error) {
        console.error('Erro no cálculo de ET0:', error);
        
        // Fallback: tentar buscar do Gist diretamente
        try {
            const ET0Calculator = (await import('./et0-calculator.js')).default;
            const targetDate = date || new Date().toISOString().split('T')[0];
            const gistET0 = await ET0Calculator.fetchET0FromGist(stationId, targetDate);
            
            if (gistET0) {
                return {
                    success: true,
                    data: {
                        value: gistET0.value,
                        unit: gistET0.unit,
                        date: targetDate,
                        calculated: false,
                        method: 'gist_xml',
                        parameters: {},
                        data_quality: gistET0.quality,
                        note: gistET0.note,
                        source: 'gist'
                    }
                };
            }
        } catch (gistError) {
            console.error('Erro ao buscar do Gist:', gistError);
        }
        
        // Fallback original para estimativa sazonal
        const month = new Date().getMonth();
        let defaultET0;
        
        if (month >= 9 || month <= 2) {
            defaultET0 = 4.5;  // Verão/Outono - maior evapotranspiração
        } else if (month >= 3 && month <= 5) {
            defaultET0 = 3.0;  // Outono/Inverno
        } else {
            defaultET0 = 2.5;  // Inverno/Primavera
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
                    regiao: 'oeste_bahia',
                    fonte: 'media_sazonal'
                },
                data_quality: 'baixa',
                note: 'Valor estimado baseado na média sazonal da região Oeste da Bahia'
            }
        };
    }
}

// ============================================
// API ROUTE HANDLER
// ============================================

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

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
        result = await getStations(publicKey, privateKey);
        break;
      
      case 'getStationInfo':
        if (!stationId) throw new Error('stationId é obrigatório');
        result = await getStationInfo(stationId, publicKey, privateKey);
        break;
      
      case 'getStationLastData':
        if (!stationId) throw new Error('stationId é obrigatório');
        result = await getStationLastData(stationId, hoursBack, publicKey, privateKey);
        break;
      
      case 'calculateET0':
        if (!stationId) throw new Error('stationId é obrigatório');
        result = await calculateET0(stationId, date, publicKey, privateKey);
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