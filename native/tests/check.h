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

/** A condition, with something to print when it does not hold. A non-template
    overload, so it wins over the three-argument comparison above. */
inline void check (const char* label, bool got, const std::string& detail)
{
    if (! got)
    {
        ++jaminFailures;
        std::printf ("FAIL %s: %s\n", label, detail.c_str());
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
