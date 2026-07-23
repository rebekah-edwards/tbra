#import <Foundation/Foundation.h>

#if __has_attribute(swift_private)
#define AC_SWIFT_PRIVATE __attribute__((swift_private))
#else
#define AC_SWIFT_PRIVATE
#endif

/// The "GoogleG" asset catalog image resource.
static NSString * const ACImageNameGoogleG AC_SWIFT_PRIVATE = @"GoogleG";

#undef AC_SWIFT_PRIVATE
