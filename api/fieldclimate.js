import FieldClimateAPI from '../../lib/connectionAPI';

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
      endpoint,
      method = 'GET',
      hoursBack = 24,
      date,
      ...params 
    } = req.body;

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
      
      case 'directRequest':
        if (!endpoint) throw new Error('endpoint é obrigatório');
        result = await FieldClimateAPI.request(method, endpoint, params, publicKey, privateKey);
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
  // Remover dados sensíveis
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
  // Implementação simplificada - na prática, você precisaria coletar dados e calcular
  try {
    // Primeiro, obter dados da estação
    const stationData = await getStationLastData(stationId, 24, publicKey, privateKey);
    
    // Extrair parâmetros (implementação simplificada)
    const params = extractParamsFromData(stationData);
    
    // Calcular ET0 baseado nos parâmetros disponíveis
    const et0Value = await calculateET0Value(params, publicKey, privateKey);
    
    return {
      success: true,
      data: {
        value: et0Value,
        unit: 'mm/dia',
        date: date || new Date().toISOString().split('T')[0],
        calculated: true,
        method: 'penman_monteith_simplificado',
        parameters: params,
        data_quality: 'media'
      }
    };
  } catch (error) {
    console.error('Erro no cálculo de ET0:', error);
    return {
      success: false,
      message: "Erro no cálculo de ET0",
      error: error.message
    };
  }
}

function extractParamsFromData(data) {
  // Implementação simplificada de extração de parâmetros
  const params = {
    temperatura_media: null,
    temperatura_maxima: null,
    temperatura_minima: null,
    umidade_relativa: null,
    radiacao_solar: null,
    velocidade_vento: null
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
}

async function calculateET0Value(params, publicKey, privateKey) {
  const { 
    temperatura_media, 
    temperatura_maxima, 
    temperatura_minima,
    umidade_relativa,
    radiacao_solar,
    velocidade_vento 
  } = params;
  
  // Cálculo simplificado baseado no método Penman-Monteith
  if (temperatura_media && umidade_relativa && radiacao_solar && velocidade_vento) {
    const Tmean = temperatura_media;
    const RHmean = umidade_relativa;
    const Rs = radiacao_solar;
    const u2 = velocidade_vento || 2.0;
    
    // Pressão de vapor
    const es = 0.6108 * Math.exp((17.27 * Tmean) / (Tmean + 237.3));
    const ea = (RHmean / 100) * es;
    const VPD = es - ea;
    
    // Declividade
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
    
    // ET0 Penman-Monteith
    const numerator = 0.408 * delta * (Rn - G) + 
                     gamma * (900 / (Tmean + 273)) * u2 * VPD;
    const denominator = delta + gamma * (1 + 0.34 * u2);
    
    const ET0 = numerator / denominator;
    return Math.max(0, parseFloat(ET0.toFixed(1)));
  }
  
  // Fallback para Hargreaves se não tiver todos os dados
  if (temperatura_maxima && temperatura_minima) {
    const Tmean = (temperatura_maxima + temperatura_minima) / 2;
    const Ra = radiacao_solar ? radiacao_solar * 0.0864 : 15;
    const ET0 = 0.0023 * Ra * (Tmean + 17.8) * Math.sqrt(temperatura_maxima - temperatura_minima);
    return Math.max(0, parseFloat(ET0.toFixed(1)));
  }
  
  // Fallback final
  return 3.5; // Valor padrão
}