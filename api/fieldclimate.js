import CryptoJS from 'crypto-js';
import xml2js from 'xml2js';
import fetch from 'node-fetch';

// Módulo FieldClimateAPI incorporado diretamente
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

// Função para buscar dados históricos do Gist
async function getHistoricalET0FromGist(startDate, endDate) {
    const gistUrl = 'https://gist.githubusercontent.com/jezielreis/5aa95bed00d0ec12153b41f8f0370de0/raw/0e7fd4264365f7d20a532cfa1f34932b97f580bd/031133E8_station_data.xml';
    
    try {
        const response = await fetch(gistUrl);
        const xmlData = await response.text();
        
        const parser = new xml2js.Parser({ explicitArray: false });
        const result = await parser.parseStringPromise(xmlData);
        
        // Extrair linhas da planilha
        const worksheet = result.Workbook?.Worksheet;
        if (!worksheet) {
            throw new Error('Estrutura do XML não encontrada');
        }
        
        const table = worksheet.Table;
        const rows = table.Row;
        
        if (!rows || !Array.isArray(rows)) {
            throw new Error('Nenhuma linha de dados encontrada');
        }
        
        // Encontrar índices das colunas
        const headerRow = rows[0];
        const headers = headerRow.Cell.map(cell => {
            const data = cell.Data;
            return data && data['_'] ? data['_'] : '';
        });
        
        const dateIndex = headers.findIndex(h => h.includes('Data/Horário'));
        const et0Index = headers.findIndex(h => h.includes('ET0 [mm]'));
        
        if (dateIndex === -1 || et0Index === -1) {
            throw new Error('Colunas de data ou ET0 não encontradas');
        }
        
        // Processar linhas de dados
        const et0Values = [];
        
        for (let i = 1; i < rows.length; i++) {
            const row = rows[i];
            if (!row.Cell || !Array.isArray(row.Cell)) continue;
            
            // Garantir que temos células suficientes
            const cells = row.Cell;
            if (cells.length <= Math.max(dateIndex, et0Index)) continue;
            
            const dateCell = cells[dateIndex];
            const et0Cell = cells[et0Index];
            
            if (!dateCell?.Data || !et0Cell?.Data) continue;
            
            const dateTime = dateCell.Data['_'] || dateCell.Data;
            const et0Value = et0Cell.Data['_'] || et0Cell.Data;
            
            if (!dateTime || !et0Value) continue;
            
            // Verificar se é horário 00:00:00
            if (!dateTime.includes('00:00:00')) continue;
            
            // Extrair apenas a data (YYYY-MM-DD)
            const dateOnly = dateTime.split(' ')[0];
            
            // Filtrar por período
            if (dateOnly >= startDate && dateOnly <= endDate) {
                const et0Num = parseFloat(et0Value);
                if (!isNaN(et0Num)) {
                    et0Values.push({
                        date: dateOnly,
                        value: et0Num
                    });
                }
            }
        }
        
        if (et0Values.length === 0) {
            return {
                success: true,
                data: {
                    period: `${startDate} a ${endDate}`,
                    count: 0,
                    average: 0,
                    min: 0,
                    max: 0,
                    values: [],
                    note: 'Nenhum dado de ET0 encontrado para o período.'
                }
            };
        }
        
        // Calcular estatísticas
        const values = et0Values.map(v => v.value);
        const sum = values.reduce((a, b) => a + b, 0);
        const average = sum / values.length;
        const min = Math.min(...values);
        const max = Math.max(...values);
        
        return {
            success: true,
            data: {
                period: `${startDate} a ${endDate}`,
                count: et0Values.length,
                average: parseFloat(average.toFixed(2)),
                min: parseFloat(min.toFixed(2)),
                max: parseFloat(max.toFixed(2)),
                values: et0Values
            }
        };
        
    } catch (error) {
        console.error('Erro ao processar dados do Gist:', error);
        return {
            success: false,
            message: `Erro ao processar dados históricos: ${error.message}`
        };
    }
}

// Funções auxiliares que usam a API
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

async function calculateET0(stationId, date, publicKey, privateKey) {
  try {
    // Obter dados da estação
    const stationData = await getStationLastData(stationId, 24, publicKey, privateKey);
    
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
      startDate,
      endDate,
      ...params 
    } = req.body;

    // Obter chaves das variáveis de ambiente
    const publicKey = process.env.FIELDCLIMATE_PUBLIC_KEY;
    const privateKey = process.env.FIELDCLIMATE_PRIVATE_KEY;

    // Verificar chaves apenas para ações que precisam da API FieldClimate
    const needsApiKeys = ['testConnection', 'getUserInfo', 'getStations', 'getStationInfo', 'getStationLastData', 'calculateET0'];
    
    if (needsApiKeys.includes(action)) {
      if (!publicKey || !privateKey) {
        return res.status(500).json({ 
          success: false, 
          message: 'Chaves da API não configuradas no servidor.' 
        });
      }
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
      
      case 'getHistoricalET0':
        if (!startDate || !endDate) throw new Error('startDate e endDate são obrigatórios');
        result = await getHistoricalET0FromGist(startDate, endDate);
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