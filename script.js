const SUPABASE_URL = 'https://fqauhrsdburhobgllhyf.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZxYXVocnNkYnVyaG9iZ2xsaHlmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDY3NDIyOTIsImV4cCI6MjA2MjMxODI5Mn0.9iu9D8MbHk5IFjd6S_p8YV9AKhqdHLDapsh2s4syUCE';

// ==========================================
// VARIABLES DEL SISTEMA
// ==========================================
let sistemaActivo = false;
let intervalos = [];
let riegosActivos = new Map();
let supabase = null;

// Función para mostrar la hora actual
function actualizarHora() {
    const now = new Date();
    const timeString = now.toLocaleString('es-AR', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });
    document.getElementById('currentTime').textContent = timeString;
}

// Actualizar hora cada segundo
setInterval(actualizarHora, 1000);
actualizarHora();

// Sistema de logs
function agregarLog(mensaje, tipo = 'info') {
    const logsContainer = document.getElementById('logsContainer');
    const logEntry = document.createElement('div');
    logEntry.className = 'log-entry';
    
    const now = new Date();
    const timeStr = now.toLocaleTimeString('es-AR');
    
    logEntry.innerHTML = `
        <span class="log-time">[${timeStr}]</span> 
        <span class="log-${tipo}">${mensaje}</span>
    `;
    
    logsContainer.insertBefore(logEntry, logsContainer.firstChild);
    
    // Mantener solo los últimos 50 logs
    while (logsContainer.children.length > 50) {
        logsContainer.removeChild(logsContainer.lastChild);
    }
}

// Mostrar errores
function mostrarError(mensaje) {
    const errorContainer = document.getElementById('errorContainer');
    errorContainer.innerHTML = `
        <div class="error-message">
            ⚠️ Error: ${mensaje}
        </div>
    `;
    agregarLog(`Error: ${mensaje}`, 'error');
}

// Limpiar errores
function limpiarErrores() {
    document.getElementById('errorContainer').innerHTML = '';
}

// Inicializar Supabase
function inicializarSupabase() {
    try {
        // Verificar que supabaseJs esté disponible
        if (typeof supabaseJs === 'undefined') {
            mostrarError('La librería de Supabase no se cargó correctamente');
            return false;
        }
        
        // Verificar que las credenciales estén configuradas
        if (SUPABASE_URL === 'https://tu-proyecto.supabase.co' || 
            SUPABASE_ANON_KEY === 'tu-clave-anonima-aqui') {
            mostrarError('Por favor, configura las credenciales de Supabase en el código');
            return false;
        }
        
        // Inicializar el cliente de Supabase
        supabase = supabaseJs.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
        
        limpiarErrores();
        agregarLog('Conexión a Supabase establecida', 'success');
        return true;
    } catch (error) {
        mostrarError('Error al conectar con Supabase: ' + error.message);
        return false;
    }
}

// Cargar zonas desde la base de datos
async function cargarZonas() {
    try {
        const { data: zonas, error } = await supabase
            .from('zonas')
            .select('*')
            .order('name');
        
        if (error) throw error;
        
        mostrarZonas(zonas || []);
        agregarLog(`${zonas?.length || 0} zonas cargadas`, 'success');
        return zonas || [];
    } catch (error) {
        mostrarError('Error al cargar zonas: ' + error.message);
        return [];
    }
}

// Mostrar zonas en la interfaz
function mostrarZonas(zonas) {
    const container = document.getElementById('zonesContainer');
    
    if (zonas.length === 0) {
        container.innerHTML = '<div class="zone-card"><p>No se encontraron zonas configuradas</p></div>';
        return;
    }
    
    container.innerHTML = zonas.map(zona => `
        <div class="zone-card ${zona.active ? 'active' : 'inactive'}">
            <div class="zone-header">
                <div class="zone-name">${zona.name}</div>
                <div class="zone-status ${zona.active ? 'active' : 'inactive'}">
                    ${zona.active ? '🟢 ACTIVA' : '🔴 INACTIVA'}
                </div>
            </div>
            <div class="zone-info">
                <p><strong>Descripción:</strong> ${zona.description || 'Sin descripción'}</p>
                <p><strong>Humedad:</strong> ${zona.humidity || 'No medida'}%</p>
            </div>
        </div>
    `).join('');
}

// Verificar y ejecutar riegos programados
async function verificarRiegos() {
    try {
        const now = new Date();
        const horaActual = now.toTimeString().slice(0, 8); // HH:MM:SS
        const fechaActual = now.toISOString().split('T')[0]; // YYYY-MM-DD
        
        // Buscar riegos programados para la hora actual que no hayan sido ejecutados
        const { data: programaciones, error } = await supabase
            .from('programacion')
            .select('*')
            .eq('scheduled_time', horaActual)
            .eq('executed', false)
            .gte('created_at', fechaActual + 'T00:00:00');
        
        if (error) throw error;
        
        if (programaciones && programaciones.length > 0) {
            for (const prog of programaciones) {
                await iniciarRiego(prog);
            }
        }
        
        // Verificar riegos que deben finalizar
        verificarFinalizacionRiegos();
        
    } catch (error) {
        agregarLog(`Error al verificar riegos: ${error.message}`, 'error');
    }
}

// Iniciar un riego
async function iniciarRiego(programacion) {
    try {
        // Activar la zona
        const { error: updateError } = await supabase
            .from('zonas')
            .update({ active: true })
            .eq('id', programacion.zone_id);
        
        if (updateError) throw updateError;
        
        // Marcar como ejecutado y agregar started_at
        const { error: execError } = await supabase
            .from('programacion')
            .update({ 
                executed: true,
                started_at: new Date().toISOString()
            })
            .eq('id', programacion.id);
        
        if (execError) throw execError;
        
        // Programar finalización
        const duracionMs = programacion.duration * 60 * 1000; // convertir minutos a milisegundos
        const finalizacionTime = Date.now() + duracionMs;
        
        riegosActivos.set(programacion.id, {
            zone_id: programacion.zone_id,
            finalizacion: finalizacionTime,
            duracion: programacion.duration
        });
        
        agregarLog(`🚿 Iniciando riego en zona ${programacion.zone_id} por ${programacion.duration} minutos`, 'success');
        
        // Recargar zonas para actualizar la interfaz
        await cargarZonas();
        
    } catch (error) {
        agregarLog(`Error al iniciar riego: ${error.message}`, 'error');
    }
}

// Verificar finalización de riegos
async function verificarFinalizacionRiegos() {
    const now = Date.now();
    const riegosFinalizados = [];
    
    for (const [progId, riego] of riegosActivos) {
        if (now >= riego.finalizacion) {
            riegosFinalizados.push({ progId, riego });
        }
    }
    
    for (const { progId, riego } of riegosFinalizados) {
        await finalizarRiego(progId, riego);
    }
}

// Finalizar un riego
async function finalizarRiego(programacionId, riego) {
    try {
        // Desactivar la zona
        const { error: updateError } = await supabase
            .from('zonas')
            .update({ active: false })
            .eq('id', riego.zone_id);
        
        if (updateError) throw updateError;
        
        // Marcar como completado
        const { error: completeError } = await supabase
            .from('programacion')
            .update({ 
                completed: true
            })
            .eq('id', programacionId);
        
        if (completeError) throw completeError;
        
        // Remover de riegos activos
        riegosActivos.delete(programacionId);
        
        agregarLog(`✅ Finalizando riego en zona ${riego.zone_id}`, 'success');
        
        // Recargar zonas para actualizar la interfaz
        await cargarZonas();
        
    } catch (error) {
        agregarLog(`Error al finalizar riego: ${error.message}`, 'error');
    }
}

// Actualizar estado del sistema
function actualizarEstadoSistema() {
    const statusElement = document.getElementById('systemStatus');
    const riegosActivosCount = riegosActivos.size;
    
    if (!sistemaActivo) {
        statusElement.textContent = 'Sistema detenido';
        statusElement.style.color = '#e17055';
    } else if (riegosActivosCount > 0) {
        statusElement.textContent = `Sistema activo - ${riegosActivosCount} riego(s) en curso`;
        statusElement.style.color = '#00b894';
    } else {
        statusElement.textContent = 'Sistema activo - Esperando programaciones';
        statusElement.style.color = '#74b9ff';
    }
}

// Iniciar el sistema
async function iniciarSistema() {
    if (!inicializarSupabase()) return;
    
    sistemaActivo = true;
    const intervalo = parseInt(document.getElementById('checkInterval').value) * 1000;
    
    // Cargar zonas iniciales
    await cargarZonas();
    
    // Configurar verificación periódica
    const intervalId = setInterval(async () => {
        if (sistemaActivo) {
            await verificarRiegos();
            actualizarEstadoSistema();
        }
    }, intervalo);
    
    intervalos.push(intervalId);
    
    agregarLog(`🚀 Sistema iniciado (verificando cada ${intervalo/1000} segundos)`, 'success');
    actualizarEstadoSistema();
}

// Detener el sistema
function detenerSistema() {
    sistemaActivo = false;
    
    // Limpiar todos los intervalos
    intervalos.forEach(clearInterval);
    intervalos = [];
    
    // Limpiar riegos activos
    riegosActivos.clear();
    
    agregarLog('⏹️ Sistema detenido', 'info');
    actualizarEstadoSistema();
}

// Inicialización cuando se carga la página
window.addEventListener('load', function() {
    agregarLog('🌱 Sistema de riego automático cargado', 'info');
    
    // Verificar que Supabase esté disponible
    if (typeof supabaseJs === 'undefined') {
        mostrarError('Error: La librería de Supabase no se cargó. Verifica tu conexión a internet.');
    } else {
        agregarLog('✅ Librería Supabase cargada correctamente', 'success');
    }
});
