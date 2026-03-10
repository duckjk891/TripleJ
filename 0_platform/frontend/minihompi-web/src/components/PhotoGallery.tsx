import { useEffect, useState, useRef } from 'react';
import { getPhotos, uploadPhoto } from '../api';
import './PhotoGallery.css';

interface Photo {
  id: number;
  image_url: string;
  caption: string;
  created_at: string;
}

interface PhotoGalleryProps {
  userId: string;
}

function PhotoGallery({ userId }: PhotoGalleryProps) {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const fetchPhotos = async () => {
    try {
      const res = await getPhotos(userId);
      setPhotos(res.data.photos || res.data || []);
    } catch {
      // API not ready yet
    }
  };

  useEffect(() => {
    fetchPhotos();
  }, [userId]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      await uploadPhoto(userId, formData);
      await fetchPhotos();
    } catch {
      alert('업로드에 실패했습니다.');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <div className="photo-gallery">
      <div className="photo-header">
        <h3>Photo</h3>
        <label className="photo-upload-btn">
          {uploading ? '업로드 중...' : '사진 올리기'}
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            onChange={handleUpload}
            hidden
            disabled={uploading}
          />
        </label>
      </div>

      {photos.length === 0 ? (
        <div className="photo-empty">
          <p>아직 등록된 사진이 없습니다.</p>
          <p className="photo-empty-sub">추억을 사진으로 남겨보세요 ♥</p>
        </div>
      ) : (
        <div className="photo-grid">
          {photos.map((photo) => (
            <div key={photo.id} className="photo-item">
              <div className="photo-img-wrapper">
                <img src={photo.image_url} alt={photo.caption} />
              </div>
              {photo.caption && (
                <p className="photo-caption">{photo.caption}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default PhotoGallery;
