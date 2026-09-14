/* Can a plain process on this machine do multicast discovery, and does macOS
   ask permission first? Sends to a group, listens on it, reports what arrives. */
#include <arpa/inet.h>
#include <netinet/in.h>
#include <stdio.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/time.h>
#include <unistd.h>

int main(void) {
    const char *group = "239.7.7.7";
    const int port = 47717;

    int rx = socket(AF_INET, SOCK_DGRAM, 0);
    int on = 1;
    setsockopt(rx, SOL_SOCKET, SO_REUSEPORT, &on, sizeof(on));
    setsockopt(rx, SOL_SOCKET, SO_REUSEADDR, &on, sizeof(on));

    struct sockaddr_in addr = {0};
    addr.sin_family = AF_INET;
    addr.sin_addr.s_addr = htonl(INADDR_ANY);
    addr.sin_port = htons(port);
    if (bind(rx, (struct sockaddr *) &addr, sizeof(addr)) < 0) { perror("bind"); return 1; }

    struct ip_mreq mreq = {0};
    mreq.imr_multiaddr.s_addr = inet_addr(group);
    mreq.imr_interface.s_addr = htonl(INADDR_ANY);
    if (setsockopt(rx, IPPROTO_IP, IP_ADD_MEMBERSHIP, &mreq, sizeof(mreq)) < 0) {
        perror("IP_ADD_MEMBERSHIP"); return 1;
    }
    printf("joined %s:%d\n", group, port);

    int tx = socket(AF_INET, SOCK_DGRAM, 0);
    unsigned char loop = 1;
    setsockopt(tx, IPPROTO_IP, IP_MULTICAST_LOOP, &loop, sizeof(loop));
    unsigned char ttl = 1;   /* this subnet only */
    setsockopt(tx, IPPROTO_IP, IP_MULTICAST_TTL, &ttl, sizeof(ttl));

    struct sockaddr_in to = {0};
    to.sin_family = AF_INET;
    to.sin_addr.s_addr = inet_addr(group);
    to.sin_port = htons(port);

    const char *hello = "jamin/1 hello";
    if (sendto(tx, hello, strlen(hello), 0, (struct sockaddr *) &to, sizeof(to)) < 0) {
        perror("sendto"); return 1;
    }
    printf("sent\n");

    struct timeval timeout = { .tv_sec = 2 };
    setsockopt(rx, SOL_SOCKET, SO_RCVTIMEO, &timeout, sizeof(timeout));

    char buffer[256];
    struct sockaddr_in from = {0};
    socklen_t fromLen = sizeof(from);
    const ssize_t got = recvfrom(rx, buffer, sizeof(buffer) - 1, 0, (struct sockaddr *) &from, &fromLen);
    if (got < 0) { perror("recvfrom (nothing came back)"); return 2; }

    buffer[got] = 0;
    printf("received \"%s\" from %s\n", buffer, inet_ntoa(from.sin_addr));
    return 0;
}
