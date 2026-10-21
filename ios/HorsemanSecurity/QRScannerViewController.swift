import UIKit
import AVFoundation

/// Full-screen camera that reads one QR code (guard-tour checkpoint labels) and returns its text.
final class QRScannerViewController: UIViewController, AVCaptureMetadataOutputObjectsDelegate {
    private let prompt: String
    private let onResult: (String?) -> Void
    private let session = AVCaptureSession()
    private var preview: AVCaptureVideoPreviewLayer?
    private var done = false

    init(prompt: String, onResult: @escaping (String?) -> Void) {
        self.prompt = prompt
        self.onResult = onResult
        super.init(nibName: nil, bundle: nil)
        modalPresentationStyle = .fullScreen
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black

        let label = UILabel()
        label.text = prompt
        label.textColor = .white
        label.font = .systemFont(ofSize: 17, weight: .semibold)
        label.textAlignment = .center
        label.numberOfLines = 2
        label.translatesAutoresizingMaskIntoConstraints = false

        let frame = UIView()
        frame.layer.borderColor = UIColor(red: 0.84, green: 0.71, blue: 0.49, alpha: 1).cgColor
        frame.layer.borderWidth = 3
        frame.layer.cornerRadius = 18
        frame.translatesAutoresizingMaskIntoConstraints = false

        var config = UIButton.Configuration.filled()
        config.title = "Cancel"
        config.baseBackgroundColor = UIColor(white: 0.15, alpha: 0.9)
        config.baseForegroundColor = .white
        config.cornerStyle = .capsule
        let cancel = UIButton(configuration: config, primaryAction: UIAction { [weak self] _ in self?.finish(nil) })
        cancel.translatesAutoresizingMaskIntoConstraints = false

        view.addSubview(frame)
        view.addSubview(label)
        view.addSubview(cancel)
        NSLayoutConstraint.activate([
            frame.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            frame.centerYAnchor.constraint(equalTo: view.centerYAnchor),
            frame.widthAnchor.constraint(equalTo: view.widthAnchor, multiplier: 0.7),
            frame.heightAnchor.constraint(equalTo: frame.widthAnchor),
            label.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 24),
            label.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -24),
            label.bottomAnchor.constraint(equalTo: frame.topAnchor, constant: -28),
            cancel.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            cancel.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -28),
            cancel.widthAnchor.constraint(equalToConstant: 160),
            cancel.heightAnchor.constraint(equalToConstant: 48)
        ])

        AVCaptureDevice.requestAccess(for: .video) { granted in
            DispatchQueue.main.async { granted ? self.startCamera() : self.showNoCamera() }
        }
    }

    private func startCamera() {
        guard let device = AVCaptureDevice.default(for: .video),
              let input = try? AVCaptureDeviceInput(device: device),
              session.canAddInput(input) else { showNoCamera(); return }
        session.addInput(input)
        let output = AVCaptureMetadataOutput()
        guard session.canAddOutput(output) else { showNoCamera(); return }
        session.addOutput(output)
        output.setMetadataObjectsDelegate(self, queue: .main)
        output.metadataObjectTypes = [.qr]

        let layer = AVCaptureVideoPreviewLayer(session: session)
        layer.videoGravity = .resizeAspectFill
        layer.frame = view.bounds
        view.layer.insertSublayer(layer, at: 0)
        preview = layer
        DispatchQueue.global(qos: .userInitiated).async { self.session.startRunning() }
    }

    private func showNoCamera() {
        let a = UIAlertController(title: "Camera unavailable",
                                  message: "Allow camera access for 4 Horseman in Settings, or type the code printed under the QR label.",
                                  preferredStyle: .alert)
        a.addAction(UIAlertAction(title: "OK", style: .default) { _ in self.finish(nil) })
        present(a, animated: true)
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        preview?.frame = view.bounds
    }

    func metadataOutput(_ output: AVCaptureMetadataOutput, didOutput objects: [AVMetadataObject], from connection: AVCaptureConnection) {
        guard let code = (objects.first as? AVMetadataMachineReadableCodeObject)?.stringValue, !code.isEmpty else { return }
        UINotificationFeedbackGenerator().notificationOccurred(.success)
        finish(code)
    }

    private func finish(_ code: String?) {
        guard !done else { return }
        done = true
        if session.isRunning { DispatchQueue.global().async { self.session.stopRunning() } }
        dismiss(animated: true) { self.onResult(code) }
    }
}
