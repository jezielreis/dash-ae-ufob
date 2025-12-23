export default async function handler(req, res) {
  // Configuração de CORS
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
      startDate,
      endDate,
      ...params 
    } = req.body;

    // Obter chaves UMA VEZ no início
    const publicKey = process.env.FIELDCLIMATE_PUBLIC_KEY;
    const privateKey = process.env.FIELDCLIMATE_PRIVATE_KEY;

    let result;

    switch (action) {
      case 'testConnection':
        // Verificar chaves APENAS AQUI
        if (!publicKey || !privateKey) {
          return res.status(500).json({ 
            success: false, 
            message: 'Chaves da API não configuradas no servidor.' 
          });
        }
        result = await testConnection(publicKey, privateKey);
        break;
      
      case 'getUserInfo':
        if (!publicKey || !privateKey) {
          return res.status(500).json({ 
            success: false, 
            message: 'Chaves da API não configuradas no servidor.' 
          });
        }
        result = await getUserInfo(publicKey, privateKey);
        break;
      
      case 'getStations':
        if (!publicKey || !privateKey) {
          return res.status(500).json({ 
            success: false, 
            message: 'Chaves da API não configuradas no servidor.' 
          });
        }
        result = await getStations(publicKey, privateKey);
        break;
      
      case 'getStationInfo':
        if (!stationId) throw new Error('stationId é obrigatório');
        if (!publicKey || !privateKey) {
          return res.status(500).json({ 
            success: false, 
            message: 'Chaves da API não configuradas no servidor.' 
          });
        }
        result = await getStationInfo(stationId, publicKey, privateKey);
        break;
      
      case 'getStationLastData':
        if (!stationId) throw new Error('stationId é obrigatório');
        if (!publicKey || !privateKey) {
          return res.status(500).json({ 
            success: false, 
            message: 'Chaves da API não configuradas no servidor.' 
          });
        }
        result = await getStationLastData(stationId, hoursBack, publicKey, privateKey);
        break;
      
      case 'calculateET0':
        if (!stationId) throw new Error('stationId é obrigatório');
        if (!publicKey || !privateKey) {
          return res.status(500).json({ 
            success: false, 
            message: 'Chaves da API não configuradas no servidor.' 
          });
        }
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