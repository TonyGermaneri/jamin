#pragma once

#include <juce_core/juce_core.h>

namespace jamin
{

/**
    Where the built page and the compiler bundle are read from.

    $JAMIN_WEB_DIR if it is set and has a page in it, so `npm run build` and
    reopening the editor is the whole iteration loop; otherwise Resources/web
    inside this bundle.

    Said once per process, because a blank editor is almost always a page that is
    not where the plugin looked, and that is the one line that answers it.
*/
juce::File webRoot();

} // namespace jamin
