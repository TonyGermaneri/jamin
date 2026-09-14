#include "check.h"

void sequenceTests();
void songBusTests();
void discoveryTests();

int main()
{
    sequenceTests();
    songBusTests();
    discoveryTests();

    std::printf (jaminFailures == 0 ? "native: all checks passed\n"
                                    : "native: %d FAILED\n", jaminFailures);
    return jaminFailures == 0 ? 0 : 1;
}
