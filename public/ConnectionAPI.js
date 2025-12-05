// ConnectionAPI.js - Versão para cliente (sem chaves)
const FieldClimateAPI = {
    baseUrl: '/api/fieldclimate', // Usa proxy local
    
    // Método principal para fazer requisições
    async request(method, endpoint, data = null) {
        const url = this.baseUrl + endpoint;
        
        const options = {
            method: method,
            headers: {
                "Accept": "application/json",
            },
            mode: 'cors',
        };
        
        if (data && method !== "GET") {
            options.headers["Content-Type"] = "application/json";
            options.body = JSON.stringify(data);
        }
        
        try {
            const response = await fetch(url, options);
            
            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`HTTP ${response.status}: ${errorText}`);
            }
            
            return await response.json();
            
        } catch (error) {
            console.error("Erro na requisição:", error.message);
            throw error;
        }
    },
    
    // ============================================
    // MÉTODOS DA API (mantém a mesma interface)
    // ============================================
    
    async getUserInfo() {
        try {
            const response = await this.request("GET", "/user");
            return {
                success: true,
                stations_count: response.stations_count || 0,
                message: "Usuário autenticado com sucesso"
            };
        } catch (error) {
            return {
                success: false,
                message: "Não foi possível verificar informações do usuário"
            };
        }
    },
    
    async getStations() {
        return this.request("GET", "/user/stations");
    },
    
    async getStationInfo(stationId) {
        const info = await this.request("GET", `/station/${stationId}`);
        // Remove informações sensíveis
        delete info?.api_keys;
        delete info?.private_keys;
        delete info?.tokens;
        return info;
    },
    
    async getStationLastData(stationId, hoursBack = 24) {
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
        
        return this.request("GET", `/data/${stationId}/data/${from}/${to}`);
    },
    
    async getStationRawData(stationId, hoursBack = 24) {
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
        
        return this.request("GET", `/data/${stationId}/raw/${from}/${to}`);
    },
    
    async getStationChartData(stationId, hoursBack = 24) {
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
        
        return this.request("GET", `/data/${stationId}/chart/${from}/${to}`);
    },
    
    async testConnection() {
        try {
            const stations = await this.getStations();
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
    },
    
    getStationMetaData(station) {
        if (!station || !station.meta) return null;
        
        return {
            temperatura: station.meta.airTemp,
            umidade: station.meta.rh,
            radiacao_solar: station.meta.solarRadiation,
            chuva_ultima: station.meta.rain_last,
            chuva_1h: station.meta.rain1h,
            velocidade_vento: station.meta.windSpeed,
            bateria: station.meta.battery,
            painel_solar: station.meta.solarPanel,
            temperatura_minima_diaria: station.meta.airTemperatureDailyMinimum,
            chuva_24h: station.meta.rain24h?.sum,
            chuva_48h: station.meta.rain48h?.sum,
            chuva_7d: station.meta.rain7d?.sum,
            ultima_comunicacao: station.dates?.last_communication
        };
    }
};

// Para uso global
if (typeof window !== 'undefined') {
    window.FieldClimateAPI = FieldClimateAPI;
}