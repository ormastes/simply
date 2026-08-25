#include <stdio.h>

#ifdef DEBUG
#define BUILD_TYPE "debug"
#else
#define BUILD_TYPE "release"
#endif

int main(int argc, char **argv) {
    printf("Hello from simple_make_enhanced! (build: %s)\n", BUILD_TYPE);
    printf("This was built by an enhanced SimpleOS-native Make.\n");
    return 0;
}
