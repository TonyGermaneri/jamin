#pragma once

// The same shape as the JavaScript suites: print what failed, carry on, and let
// the count decide the exit status.
#include <cstdio>
#include <string>

inline int jaminFailures = 0;

template <typename A, typename B>
void check (const char* label, const A& got, const B& want)
{
    if (! (got == static_cast<A> (want)))
    {
        ++jaminFailures;
        std::printf ("FAIL %s\n", label);
    }
}

inline void check (const char* label, bool got)
{
    if (! got)
    {
        ++jaminFailures;
        std::printf ("FAIL %s\n", label);
    }
}

inline void checkEqual (const char* label, const std::string& got, const std::string& want)
{
    if (got != want)
    {
        ++jaminFailures;
        std::printf ("FAIL %s: got \"%s\" want \"%s\"\n", label, got.c_str(), want.c_str());
    }
}
