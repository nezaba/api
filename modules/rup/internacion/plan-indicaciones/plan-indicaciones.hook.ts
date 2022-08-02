import { EventCore } from '@andes/event-bus/';
import { elementosRUPAsSet } from '../../../../modules/rup/controllers/elementos-rup.controller';
import { Auth } from '../../../../auth/auth.class';
import { Prestacion } from '../../schemas/prestacion';
import { PlanIndicaionesCtr } from './plan-indicaciones.routes';

EventCore.on('mapa-camas:plan-indicacion:create', async (prestacion) => {

    const elementosRUPSet = await elementosRUPAsSet();
    const elementoRUPPrestacion = elementosRUPSet.getByConcept(prestacion.solicitud.tipoPrestacion);
    if (elementoRUPPrestacion?.dispatch?.every(hook => hook.method === 'plan-indicaciones-validar-prestacion')) {
        prestacion = new Prestacion(prestacion);
        const registros = prestacion.getRegistros();

        const idInternacion = prestacion.trackId;
        const fecha = prestacion.ejecucion.fecha;
        const ambito = prestacion.solicitud.ambitoOrigen;
        registros.filter(r => r.esSolicitud).map(async (registro) => {
            const idRegistro = registro.id;
            const idEvolucion = registro.idEvolucion;
            const indicacion = await PlanIndicaionesCtr.findOne({ registro: idRegistro });

            if (indicacion) {
                indicacion.idPrestacion = prestacion.id;
                indicacion.estados.push({
                    tipo: 'active',
                    fecha
                });
                const user = Auth.getUserFromResource(prestacion);
                Auth.audit(indicacion, user as any);
                await indicacion.save();
            }
        });
    }
});
