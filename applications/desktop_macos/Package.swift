// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "JarvisDesktop",
    platforms: [
        .macOS(.v13)
    ],
    products: [
        .executable(
            name: "JarvisDesktop",
            targets: ["JarvisDesktop"]
        )
    ],
    dependencies: [
        .package(url: "https://github.com/apple/swift-http-types", from: "1.0.0"),
        .package(url: "https://github.com/apple/swift-nio", from: "2.0.0"),
        .package(url: "https://github.com/apple/swift-nio-ssl", from: "2.0.0")
    ],
    targets: [
        .executableTarget(
            name: "JarvisDesktop",
            dependencies: [
                .product(name: "HTTPTypes", package: "swift-http-types"),
                .product(name: "NIOCore", package: "swift-nio"),
                .product(name: "NIOSSL", package: "swift-nio-ssl")
            ]
        )
    ]
)
