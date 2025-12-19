[file name]: api/et0-calculator.js
[file content begin]
/**
 * Calculadora de Evapotranspiração de Referência (ET0) - Padrão FAO-56
 * Adaptada para a região Oeste da Bahia
 * 
 * Referências:
 * - FAO Irrigation and drainage paper 56
 * - INMET - Instituto Nacional de Meteorologia
 * - EMBRAPA - Zoneamento Agrícola
 */

class ET0Calculator {
    // Coordenadas da região Oeste da Bahia (ajustáveis por estação)
    static REGION_PARAMS = {
        '031133E8': {
            latitude: -12.15,    // Barra, BA (aproximado)
            longitude: -45.00,
            altitude: 400,       // metros
            timezone: -3         // GMT-3 (Horário de Brasília)
        }
    };

    /**
     * Calcula ET0 pelo método Penman-Monteith (FAO-56 completo)
     * @param {Object} params - Parâmetros meteorológicos
     * @param {Object} stationInfo - Informações da estação
     * @returns {Number} ET0 em mm/dia
     */
    static calculatePenmanMonteithFAO56(params, stationInfo) {
        const {
            temperatura_maxima,    // °C
            temperatura_minima,    // °C
            umidade_relativa_max,  // % (opcional)
            umidade_relativa_min,  // % (opcional)
            umidade_relativa_med,  // % (se não tiver max/min)
            radiacao_solar,        // MJ/m²/dia (JÁ CONVERTIDO!)
            velocidade_vento_2m,   // m/s a 2m de altura
            pressao_atmosferica    // kPa (opcional, calculado se não fornecido)
        } = params;

        const {
            latitude,
            altitude = 400,
            julianDay = this.getJulianDay()
        } = stationInfo;

        // 1. Temperatura média
        const Tmean = (temperatura_maxima + temperatura_minima) / 2;
        
        // 2. Pressão de vapor de saturação (es)
        const es_max = 0.6108 * Math.exp((17.27 * temperatura_maxima) / (temperatura_maxima + 237.3));
        const es_min = 0.6108 * Math.exp((17.27 * temperatura_minima) / (temperatura_minima + 237.3));
        const es = (es_max + es_min) / 2;  // kPa
        
        // 3. Pressão de vapor atual (ea)
        let ea;
        if (umidade_relativa_max && umidade_relativa_min) {
            ea = (es_min * (umidade_relativa_max / 100) + es_max * (umidade_relativa_min / 100)) / 2;
        } else if (umidade_relativa_med) {
            ea = es * (umidade_relativa_med / 100);
        } else {
            // Estimativa conservadora para semiárido
            ea = es * 0.70; // 70% de umidade relativa média
        }
        
        // 4. Déficit de pressão de vapor (VPD)
        const VPD = es - ea;  // kPa
        
        // 5. Declividade da curva de pressão de vapor (Δ)
        const delta = (4098 * es) / Math.pow(Tmean + 237.3, 2);  // kPa/°C
        
        // 6. Constante psicrométrica (γ)
        const P = pressao_atmosferica || this.calculateAtmosphericPressure(altitude);
        const gamma = 0.000665 * P;  // kPa/°C
        
        // 7. Radiação líquida (Rn)
        const Rn = this.calculateNetRadiation(
            radiacao_solar, 
            Tmean, 
            ea, 
            latitude, 
            julianDay
        );
        
        // 8. Fluxo de calor no solo (G) - simplificado para dia
        const G = 0;  // Para cálculos diários, G ≈ 0
        
        // 9. Fator do vento
        const u2 = velocidade_vento_2m || 2.0;  // m/s (default se não disponível)
        
        // 10. Cálculo final ET0 Penman-Monteith FAO-56
        const numerador = (0.408 * delta * (Rn - G)) + 
                         (gamma * (900 / (Tmean + 273)) * u2 * VPD);
        const denominador = delta + (gamma * (1 + 0.34 * u2));
        
        const ET0 = numerador / denominador;
        
        return Math.max(0, ET0);
    }

    /**
     * Método Hargreaves-Samani (quando faltam dados)
     * @param {Number} Tmax - Temperatura máxima (°C)
     * @param {Number} Tmin - Temperatura mínima (°C)
     * @param {Number} latitude - Latitude em graus decimais
     * @param {Number} julianDay - Dia juliano
     * @returns {Number} ET0 em mm/dia
     */
    static calculateHargreavesSamani(Tmax, Tmin, latitude, julianDay) {
        const Tmean = (Tmax + Tmin) / 2;
        const TR = Tmax - Tmin;  // Amplitude térmica
        
        // Radiação extraterrestre (Ra)
        const Ra = this.calculateExtraterrestrialRadiation(latitude, julianDay);
        
        // Coeficiente ajustado para o Nordeste brasileiro
        const kRs = 0.19;  // Ajustado para clima semiárido
        
        // ET0 Hargreaves-Samani original
        const ET0 = 0.0023 * (Tmean + 17.8) * Math.sqrt(TR) * Ra * kRs;
        
        return Math.max(0, ET0);
    }

    /**
     * Método Priestley-Taylor (quando não tem vento)
     * @param {Number} Tmean - Temperatura média (°C)
     * @param {Number} Rn - Radiação líquida (MJ/m²/dia)
     * @returns {Number} ET0 em mm/dia
     */
    static calculatePriestleyTaylor(Tmean, Rn) {
        // Pressão de vapor de saturação
        const es = 0.6108 * Math.exp((17.27 * Tmean) / (Tmean + 237.3));
        
        // Declividade
        const delta = (4098 * es) / Math.pow(Tmean + 237.3, 2);
        
        // Constante psicrométrica (pressão ao nível do mar)
        const gamma = 0.066;
        
        // Coeficiente α ajustado para clima úmido
        const alpha = 1.26;  // Padrão para condições úmidas
        
        // ET0 Priestley-Taylor
        const ET0 = alpha * (delta / (delta + gamma)) * (Rn / 2.45);
        
        return Math.max(0, ET0);
    }

    /**
     * Calcula radiação extraterrestre (Ra)
     * @param {Number} latitude - Latitude em graus decimais
     * @param {Number} julianDay - Dia juliano
     * @returns {Number} Ra em MJ/m²/dia
     */
    static calculateExtraterrestrialRadiation(latitude, julianDay) {
        const phi = latitude * (Math.PI / 180);  // Converter para radianos
        
        // Declinação solar (δ) - radianos
        const delta = 0.409 * Math.sin((2 * Math.PI * julianDay / 365) - 1.39);
        
        // Distância relativa Terra-Sol (dr)
        const dr = 1 + 0.033 * Math.cos(2 * Math.PI * julianDay / 365);
        
        // Ângulo de radiação solar no pôr do sol (ωs)
        const omega_s = Math.acos(-Math.tan(phi) * Math.tan(delta));
        
        // Ra - Radiação extraterrestre (MJ/m²/dia)
        const Gsc = 0.0820;  // Constante solar (MJ/m²/min)
        const Ra = (24 * 60 / Math.PI) * Gsc * dr * 
                   (omega_s * Math.sin(phi) * Math.sin(delta) + 
                    Math.cos(phi) * Math.cos(delta) * Math.sin(omega_s));
        
        return Ra;
    }

    /**
     * Calcula radiação líquida (Rn)
     * @param {Number} Rs - Radiação solar incidente (MJ/m²/dia)
     * @param {Number} Tmean - Temperatura média (°C)
     * @param {Number} ea - Pressão de vapor atual (kPa)
     * @param {Number} latitude - Latitude
     * @param {Number} julianDay - Dia juliano
     * @returns {Number} Rn em MJ/m²/dia
     */
    static calculateNetRadiation(Rs, Tmean, ea, latitude, julianDay) {
        // 1. Radiação de onda curta líquida (Rns)
        const albedo = 0.23;  // Albedo para grama (referência)
        const Rns = (1 - albedo) * Rs;
        
        // 2. Radiação de onda longa líquida (Rnl)
        const sigma = 4.903e-9;  // Constante de Stefan-Boltzmann (MJ/K⁴/m²/dia)
        const Tmax_k = Tmean + 10 + 273.16;  // Estimativa Tmax em Kelvin
        const Tmin_k = Tmean - 10 + 273.16;  // Estimativa Tmin em Kelvin
        
        // Radiação de onda longa de saída
        const Rso = this.calculateClearSkyRadiation(latitude, altitude, julianDay);
        const Rs_Rso = Math.min(Rs / Rso, 1.0);
        
        // Fator de cobertura de nuvens
        const cloudFactor = 1.35 * Rs_Rso - 0.35;
        
        // Rnl - Radiação de onda longa líquida
        const Rnl = sigma * ((Math.pow(Tmax_k, 4) + Math.pow(Tmin_k, 4)) / 2) * 
                    (0.34 - 0.14 * Math.sqrt(ea)) * cloudFactor;
        
        // 3. Radiação líquida total (Rn)
        const Rn = Rns - Rnl;
        
        return Math.max(0, Rn);
    }

    /**
     * Calcula radiação em céu claro (Rso)
     */
    static calculateClearSkyRadiation(latitude, altitude, julianDay) {
        const Ra = this.calculateExtraterrestrialRadiation(latitude, julianDay);
        // Fator de transmissividade para céu claro
        const transmissionFactor = 0.75 + (2e-5 * altitude);
        return Ra * transmissionFactor;
    }

    /**
     * Calcula pressão atmosférica pela altitude
     * @param {Number} altitude - Altitude em metros
     * @returns {Number} Pressão em kPa
     */
    static calculateAtmosphericPressure(altitude) {
        // Equação padrão FAO
        const P0 = 101.3;  // kPa ao nível do mar
        const tempK0 = 293;  // Temperatura de referência em Kelvin
        const g = 9.807;  // Aceleração gravitacional
        const M = 0.0289644;  // Massa molar do ar (kg/mol)
        const R = 8.31447;  // Constante universal dos gases
        
        const P = P0 * Math.pow((tempK0 - (0.0065 * altitude)) / tempK0, 
                               (g * M) / (R * 0.0065));
        
        return P;
    }

    /**
     * Converte radiação solar de W/m² para MJ/m²/dia
     * @param {Number} solarRadiationW - Radiação em W/m²
     * @returns {Number} Radiação em MJ/m²/dia
     */
    static convertSolarRadiationToDaily(solarRadiationW) {
        // W/m² para MJ/m²/dia: W * 0.0864 = MJ/m²/dia
        // 1 W/m² = 1 J/s/m²
        // 1 dia = 86400 segundos
        // 1 MJ = 1,000,000 J
        return (solarRadiationW * 0.0864);
    }

    /**
     * Obtém dia juliano
     * @param {Date} date - Data (default: hoje)
     * @returns {Number} Dia juliano
     */
    static getJulianDay(date = new Date()) {
        const start = new Date(date.getFullYear(), 0, 0);
        const diff = date - start;
        const oneDay = 1000 * 60 * 60 * 24;
        return Math.floor(diff / oneDay);
    }

    /**
     * Seleciona o melhor método de cálculo baseado nos dados disponíveis
     * @param {Object} params - Parâmetros disponíveis
     * @param {Object} stationInfo - Informações da estação
     * @returns {Object} Resultado do cálculo
     */
    static selectBestMethod(params, stationInfo) {
        const {
            temperatura_maxima,
            temperatura_minima,
            umidade_relativa_max,
            umidade_relativa_min,
            umidade_relativa_med,
            radiacao_solar,  // EM MJ/m²/dia!
            velocidade_vento_2m
        } = params;

        let method = '';
        let et0Value = 0;
        let quality = 'muito_baixa';
        let usedParams = {};

        // MÉTODO 1: Penman-Monteith FAO-56 Completo
        if (temperatura_maxima && temperatura_minima && radiacao_solar) {
            try {
                // Converter radiação se necessário (verifica se está em W/m²)
                let Rs_MJ = radiacao_solar;
                if (radiacao_solar > 1000) { // Provavelmente está em W/m²
                    Rs_MJ = this.convertSolarRadiationToDaily(radiacao_solar);
                }
                
                const et0Params = {
                    temperatura_maxima,
                    temperatura_minima,
                    umidade_relativa_max,
                    umidade_relativa_min,
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
                    radiacao_solar: Rs_MJ.toFixed(2),
                    velocidade_vento: velocidade_vento_2m?.toFixed(1) || '2.0 (padrão)'
                };
                
            } catch (error) {
                console.error('Erro no método Penman-Monteith:', error);
            }
        }

        // MÉTODO 2: Hargreaves-Samani (se não tiver umidade/vento)
        if ((method === '' || quality === 'muito_baixa') && 
            temperatura_maxima && temperatura_minima) {
            try {
                const julianDay = this.getJulianDay();
                et0Value = this.calculateHargreavesSamani(
                    temperatura_maxima, 
                    temperatura_minima, 
                    stationInfo.latitude || -12.15,
                    julianDay
                );
                method = 'hargreaves_samani';
                quality = 'media';
                
                usedParams = {
                    temperatura_maxima: temperatura_maxima.toFixed(1),
                    temperatura_minima: temperatura_minima.toFixed(1),
                    latitude: stationInfo.latitude?.toFixed(2) || '-12.15'
                };
                
            } catch (error) {
                console.error('Erro no método Hargreaves-Samani:', error);
            }
        }

        // MÉTODO 3: Priestley-Taylor (se tiver radiação)
        if ((method === '' || quality === 'muito_baixa') && 
            temperatura_maxima && temperatura_minima && radiacao_solar) {
            try {
                const Tmean = (temperatura_maxima + temperatura_minima) / 2;
                let Rs_MJ = radiacao_solar;
                if (radiacao_solar > 1000) {
                    Rs_MJ = this.convertSolarRadiationToDaily(radiacao_solar);
                }
                
                // Calcular radiação líquida simplificada
                const Rn = Rs_MJ * 0.77; // Aproximação
                
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

        // MÉTODO 4: Estimativa por temperatura (fallback)
        if (method === '' || quality === 'muito_baixa') {
            const Tmean = temperatura_maxima && temperatura_minima ? 
                         (temperatura_maxima + temperatura_minima) / 2 : 
                         25; // Default para Oeste da Bahia
            
            // Fórmula empírica para semiárido
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

    /**
     * Processa dados históricos para cálculo de ET0 diário
     * @param {Array} historicalData - Dados horários/diários
     * @param {Object} stationInfo - Informações da estação
     * @returns {Array} Série temporal de ET0
     */
    static processHistoricalET0(historicalData, stationInfo) {
        if (!historicalData || !historicalData.data || !Array.isArray(historicalData.data)) {
            return [];
        }

        // Agrupar por data
        const dailyData = {};
        
        historicalData.data.forEach(entry => {
            if (!entry.date) return;
            
            const date = entry.date.split('T')[0]; // Extrair apenas a data
            
            if (!dailyData[date]) {
                dailyData[date] = {
                    temps: [],
                    humidities: [],
                    solar: [],
                    winds: [],
                    rains: []
                };
            }
            
            if (entry.air_temperature !== undefined) {
                dailyData[date].temps.push(entry.air_temperature);
            }
            if (entry.relative_humidity !== undefined) {
                dailyData[date].humidities.push(entry.relative_humidity);
            }
            if (entry.solar_radiation !== undefined) {
                dailyData[date].solar.push(entry.solar_radiation);
            }
            if (entry.wind_speed !== undefined) {
                dailyData[date].winds.push(entry.wind_speed);
            }
        });

        // Calcular ET0 para cada dia
        const et0Series = [];
        
        Object.entries(dailyData).forEach(([date, data]) => {
            if (data.temps.length > 0) {
                const Tmax = Math.max(...data.temps);
                const Tmin = Math.min(...data.temps);
                const RHmean = data.humidities.length > 0 ? 
                    data.humidities.reduce((a, b) => a + b) / data.humidities.length : null;
                const Rs = data.solar.length > 0 ? 
                    data.solar.reduce((a, b) => a + b) / data.solar.length : null;
                const u2 = data.winds.length > 0 ? 
                    data.winds.reduce((a, b) => a + b) / data.winds.length : null;

                const params = {
                    temperatura_maxima: Tmax,
                    temperatura_minima: Tmin,
                    umidade_relativa_med: RHmean,
                    radiacao_solar: Rs,
                    velocidade_vento_2m: u2
                };

                const result = this.selectBestMethod(params, stationInfo);
                
                et0Series.push({
                    date,
                    et0: result.value,
                    method: result.method,
                    quality: result.quality,
                    parameters: {
                        Tmax: Tmax.toFixed(1),
                        Tmin: Tmin.toFixed(1),
                        RHmean: RHmean?.toFixed(0) || 'N/A',
                        Rs: Rs?.toFixed(0) || 'N/A'
                    }
                });
            }
        });

        return et0Series;
    }
}

export default ET0Calculator;
[file content end]