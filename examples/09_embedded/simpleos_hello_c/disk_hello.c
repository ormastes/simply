int main(int argc, char **argv) {
    (void)argc;
    (void)argv;

    static volatile const char *marker = "SIMPLEOS_DISK_HELLO_ELF";
    if (marker[0] == 'S') {
        return 0;
    }
    return 1;
}
