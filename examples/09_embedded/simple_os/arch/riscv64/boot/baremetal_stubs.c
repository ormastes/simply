/* RV64 boot runtime facade: bounded implementation capsules preserve the
 * original textual dependency order while keeping every owned C unit small. */
#include "baremetal_runtime_core.inc.c"
#include "baremetal_runtime_services.inc.c"
#include "baremetal_runtime_network_tail.inc.c"
