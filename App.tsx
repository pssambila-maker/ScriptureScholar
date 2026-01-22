
import React, { useState, useEffect, createContext, useContext } from 'react';
import { HashRouter, Routes, Route, Navigate, Link, useNavigate, useParams } from 'react-router-dom';
import {
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  User,
  GoogleAuthProvider
} from 'firebase/auth';
import { auth, db, isFirebaseConfigured, googleProvider } from './firebase';
import {
  collection,
  addDoc,
  query,
  getDocs,
  doc,
  getDoc,
  deleteDoc,
  updateDoc,
  setDoc,
  orderBy,
  serverTimestamp
} from 'firebase/firestore';
import { generateStudy, chatWithPassage } from './gemini';
import { SavedStudy, StudyAnalysis, ChatMessage } from './types';

// Helper to sync user profile info to Firestore
const syncUserProfile = async (user: User) => {
  if (!isFirebaseConfigured || !db) return;
  const userRef = doc(db, 'users', user.uid);
  await setDoc(userRef, {
    uid: user.uid,
    email: user.email,
    displayName: user.displayName,
    photoURL: user.photoURL,
    lastLogin: serverTimestamp(),
    role: 'user' // Default role for new users
  }, { merge: true });
};

// Admin Service: Fetches all studies across all users (requires admin role)
const AdminService = {
  async getAllStudies(): Promise<{ study: SavedStudy; userEmail: string; userName: string }[]> {
    if (!isFirebaseConfigured || !db) return [];
    try {
      // First get all users
      const usersSnapshot = await getDocs(collection(db, 'users'));
      const allStudies: { study: SavedStudy; userEmail: string; userName: string }[] = [];

      // For each user, get their history
      for (const userDoc of usersSnapshot.docs) {
        const userData = userDoc.data();
        const userEmail = userData.email || 'Unknown';
        const userName = userData.displayName || 'Anonymous';

        const historyQuery = query(
          collection(db, `users/${userDoc.id}/history`),
          orderBy('createdAt', 'desc')
        );
        const historySnapshot = await getDocs(historyQuery);

        historySnapshot.forEach(studyDoc => {
          const data = studyDoc.data();
          allStudies.push({
            study: {
              id: studyDoc.id,
              ...data,
              userId: userDoc.id,
              createdAt: data.createdAt?.seconds ? data.createdAt.seconds * 1000 : data.createdAt
            } as SavedStudy,
            userEmail,
            userName
          });
        });
      }

      // Sort all studies by date
      allStudies.sort((a, b) => b.study.createdAt - a.study.createdAt);
      return allStudies;
    } catch (e) {
      console.error("Admin fetch error:", e);
      return [];
    }
  },

  async checkIsAdmin(userId: string): Promise<boolean> {
    if (!isFirebaseConfigured || !db) return false;
    try {
      const userDoc = await getDoc(doc(db, 'users', userId));
      return userDoc.exists() && userDoc.data()?.role === 'admin';
    } catch (e) {
      return false;
    }
  }
};

// Storage Helper: Manages Firestore sub-collections using 'history' per security rules
const StudyService = {
  async save(userId: string, study: SavedStudy): Promise<string> {
    if (isFirebaseConfigured && db && userId !== 'guest') {
      const docRef = await addDoc(collection(db, `users/${userId}/history`), {
        ...study,
        createdAt: serverTimestamp()
      });
      return docRef.id;
    } else {
      const id = `local-${Date.now()}`;
      const localStudies = JSON.parse(localStorage.getItem('ss_studies') || '[]');
      const newStudy = { ...study, id };
      localStudies.push(newStudy);
      localStorage.setItem('ss_studies', JSON.stringify(localStudies));
      return id;
    }
  },
  async getAll(userId: string): Promise<SavedStudy[]> {
    if (isFirebaseConfigured && db && userId !== 'guest') {
      try {
        const q = query(collection(db, `users/${userId}/history`), orderBy('createdAt', 'desc'));
        const querySnapshot = await getDocs(q);
        const list: SavedStudy[] = [];
        querySnapshot.forEach(doc => {
          const data = doc.data();
          list.push({
            id: doc.id,
            ...data,
            createdAt: data.createdAt?.seconds ? data.createdAt.seconds * 1000 : data.createdAt
          } as SavedStudy);
        });
        return list;
      } catch (e) {
        console.warn("Firestore access error. Ensure rules are deployed.");
      }
    }
    return JSON.parse(localStorage.getItem('ss_studies') || '[]');
  },
  async getById(userId: string, id: string): Promise<SavedStudy | null> {
    if (isFirebaseConfigured && db && !id.startsWith('local-') && userId !== 'guest') {
      try {
        const docRef = doc(db, `users/${userId}/history/${id}`);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          const data = docSnap.data();
          return {
            id: docSnap.id,
            ...data,
            createdAt: data.createdAt?.seconds ? data.createdAt.seconds * 1000 : data.createdAt
          } as SavedStudy;
        }
      } catch (e) { console.error(e); }
    }
    const localStudies = JSON.parse(localStorage.getItem('ss_studies') || '[]');
    return localStudies.find((s: SavedStudy) => s.id === id) || null;
  },
  async update(userId: string, id: string, data: Partial<SavedStudy>): Promise<void> {
    if (isFirebaseConfigured && db && !id.startsWith('local-') && userId !== 'guest') {
      await updateDoc(doc(db, `users/${userId}/history/${id}`), data);
    } else {
      const localStudies = JSON.parse(localStorage.getItem('ss_studies') || '[]');
      const index = localStudies.findIndex((s: SavedStudy) => s.id === id);
      if (index !== -1) {
        localStudies[index] = { ...localStudies[index], ...data };
        localStorage.setItem('ss_studies', JSON.stringify(localStudies));
      }
    }
  },
  async remove(userId: string, id: string): Promise<void> {
    if (isFirebaseConfigured && db && !id.startsWith('local-') && userId !== 'guest') {
      await deleteDoc(doc(db, `users/${userId}/history/${id}`));
    } else {
      const localStudies = JSON.parse(localStorage.getItem('ss_studies') || '[]');
      const filtered = localStudies.filter((s: SavedStudy) => s.id !== id);
      localStorage.setItem('ss_studies', JSON.stringify(filtered));
    }
  },
  async clearAll(userId: string): Promise<void> {
    if (isFirebaseConfigured && db && userId !== 'guest') {
      const q = query(collection(db, `users/${userId}/history`));
      const querySnapshot = await getDocs(q);
      const deletePromises = querySnapshot.docs.map(docSnap =>
        deleteDoc(doc(db, `users/${userId}/history/${docSnap.id}`))
      );
      await Promise.all(deletePromises);
    } else {
      localStorage.setItem('ss_studies', '[]');
    }
  },
  async enforceLimit(userId: string, limit: number = 10): Promise<void> {
    if (isFirebaseConfigured && db && userId !== 'guest') {
      const q = query(collection(db, `users/${userId}/history`), orderBy('createdAt', 'desc'));
      const querySnapshot = await getDocs(q);
      const docs = querySnapshot.docs;
      if (docs.length > limit) {
        const toDelete = docs.slice(limit);
        const deletePromises = toDelete.map(docSnap =>
          deleteDoc(doc(db, `users/${userId}/history/${docSnap.id}`))
        );
        await Promise.all(deletePromises);
      }
    } else {
      const localStudies = JSON.parse(localStorage.getItem('ss_studies') || '[]');
      if (localStudies.length > limit) {
        const sorted = localStudies.sort((a: SavedStudy, b: SavedStudy) => b.createdAt - a.createdAt);
        localStorage.setItem('ss_studies', JSON.stringify(sorted.slice(0, limit)));
      }
    }
  }
};

const AuthContext = createContext<{ user: User | null; loading: boolean }>({ user: null, loading: true });
const useAuth = () => useContext(AuthContext);

// Guest Trial Helper - tracks if guest has used their free trial
const GuestTrialService = {
  hasUsedTrial(): boolean {
    return localStorage.getItem('ss_guest_trial_used') === 'true';
  },
  markTrialUsed(): void {
    localStorage.setItem('ss_guest_trial_used', 'true');
  },
  getTrialStudyId(): string | null {
    return localStorage.getItem('ss_guest_trial_study_id');
  },
  setTrialStudyId(id: string): void {
    localStorage.setItem('ss_guest_trial_study_id', id);
  }
};

// Sign In Required Modal
const SignInRequiredModal: React.FC<{ isOpen: boolean; onClose: () => void; message: string }> = ({ isOpen, onClose, message }) => {
  const navigate = useNavigate();

  if (!isOpen) return null;

  const handleSignIn = () => {
    onClose();
    navigate('/login');
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl shadow-2xl max-w-md w-full p-8 relative animate-in fade-in zoom-in duration-300">
        <button onClick={onClose} className="absolute top-4 right-4 text-slate-300 hover:text-slate-500 transition">
          <i className="fa-solid fa-times text-xl"></i>
        </button>

        <div className="text-center">
          <div className="w-16 h-16 bg-indigo-100 rounded-2xl flex items-center justify-center mx-auto mb-6">
            <i className="fa-solid fa-lock text-indigo-600 text-2xl"></i>
          </div>

          <h3 className="text-2xl font-black text-slate-900 mb-3 serif italic tracking-tighter">Sign In Required</h3>
          <p className="text-slate-500 font-medium text-sm mb-6 leading-relaxed">{message}</p>

          <div className="space-y-3">
            <button
              onClick={handleSignIn}
              className="w-full py-4 bg-indigo-600 hover:bg-indigo-700 text-white font-black text-sm uppercase tracking-widest rounded-2xl transition shadow-lg shadow-indigo-100"
            >
              Sign In with Google
            </button>
            <button
              onClick={onClose}
              className="w-full py-3 text-slate-400 hover:text-slate-600 font-bold text-xs uppercase tracking-widest transition"
            >
              Maybe Later
            </button>
          </div>

          <div className="mt-6 pt-6 border-t border-slate-100">
            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">
              Free account includes 10 saved studies
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { loading } = useAuth();
  if (loading) return (
    <div className="flex h-screen items-center justify-center bg-slate-50">
      <div className="text-center">
        <div className="inline-block w-12 h-12 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin mb-4"></div>
        <p className="text-slate-500 font-bold uppercase tracking-widest text-[10px]">Consulting Manuscripts...</p>
      </div>
    </div>
  );
  return <>{children}</>;
};

// Route that requires authentication
const AuthRequiredRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  if (loading) return (
    <div className="flex h-screen items-center justify-center bg-slate-50">
      <div className="text-center">
        <div className="inline-block w-12 h-12 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin mb-4"></div>
        <p className="text-slate-500 font-bold uppercase tracking-widest text-[10px]">Consulting Manuscripts...</p>
      </div>
    </div>
  );

  if (!user) {
    return (
      <div className="max-w-2xl mx-auto py-20 px-4 text-center">
        <div className="bg-indigo-50 p-12 rounded-3xl border border-indigo-100">
          <div className="w-16 h-16 bg-indigo-100 rounded-full flex items-center justify-center mx-auto mb-6">
            <i className="fa-solid fa-lock text-indigo-600 text-2xl"></i>
          </div>
          <h2 className="text-2xl font-black text-indigo-900 mb-4 uppercase tracking-tighter">Sign In Required</h2>
          <p className="text-indigo-600 font-bold text-sm mb-6">Please sign in to access your study history and saved studies.</p>
          <Link to="/login" className="inline-block bg-indigo-600 text-white px-8 py-3 rounded-xl font-bold text-xs uppercase tracking-widest hover:bg-indigo-700 transition">
            Sign In
          </Link>
        </div>
      </div>
    );
  }

  return <>{children}</>;
};

const Navbar = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    const checkAdmin = async () => {
      if (user) {
        const adminStatus = await AdminService.checkIsAdmin(user.uid);
        setIsAdmin(adminStatus);
      } else {
        setIsAdmin(false);
      }
    };
    checkAdmin();
  }, [user]);

  const handleLogout = async () => {
    if (auth) await signOut(auth);
    navigate('/login');
  };

  return (
    <nav className="bg-white border-b border-slate-200 px-4 py-4 sticky top-0 z-50">
      <div className="max-w-6xl mx-auto flex justify-between items-center">
        <Link to="/" className="flex items-center space-x-3 group">
          <div className="bg-indigo-600 p-2 rounded-xl shadow-lg shadow-indigo-100 group-hover:scale-110 transition-transform">
            <i className="fa-solid fa-book-bible text-white text-xl"></i>
          </div>
          <span className="text-2xl font-black text-slate-800 tracking-tighter serif italic">ScriptureScholar</span>
        </Link>
        <div className="flex items-center space-x-6">
          <Link to="/history" className="text-slate-600 hover:text-indigo-600 font-bold text-sm transition uppercase tracking-widest">History</Link>
          {isAdmin && (
            <Link to="/admin" className="text-amber-600 hover:text-amber-700 font-bold text-sm transition uppercase tracking-widest flex items-center space-x-1">
              <i className="fa-solid fa-crown text-xs"></i>
              <span>Admin</span>
            </Link>
          )}
          {user ? (
            <div className="flex items-center space-x-4">
              {user.photoURL && <img src={user.photoURL} className="w-8 h-8 rounded-full border border-slate-200 shadow-sm" alt="Profile" />}
              <div className="hidden md:block">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-tighter leading-none">Scholar</p>
                <p className="text-xs font-bold text-slate-700">{user.displayName || user.email}</p>
              </div>
              <button onClick={handleLogout} className="bg-slate-100 hover:bg-slate-200 text-slate-700 px-4 py-2 rounded-xl text-sm font-bold transition">Sign Out</button>
            </div>
          ) : (
            <Link to="/login" className="bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2.5 rounded-xl font-bold text-sm transition shadow-md">Sign In</Link>
          )}
        </div>
      </div>
    </nav>
  );
};

const Landing = () => {
  const [reference, setReference] = useState('');
  const [translation, setTranslation] = useState('ESV');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [step, setStep] = useState(0);
  const [showSignInModal, setShowSignInModal] = useState(false);
  const { user } = useAuth();
  const navigate = useNavigate();

  // Check if guest can generate a study
  const canGuestGenerate = !user && !GuestTrialService.hasUsedTrial();

  const handleAnalyze = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reference.trim()) return;

    // If not logged in and already used trial, show sign-in modal
    if (!user && GuestTrialService.hasUsedTrial()) {
      setShowSignInModal(true);
      return;
    }

    setLoading(true);
    setError('');
    setStep(0);

    const stepInterval = setInterval(() => {
      setStep(prev => (prev < 4 ? prev + 1 : prev));
    }, 2500);

    try {
      const analysis = await generateStudy(reference, translation);
      const uid = user?.uid || 'guest';
      const studyData: SavedStudy = {
        userId: uid,
        reference: analysis.reference,
        translation: analysis.translation,
        createdAt: Date.now(),
        modelMetadata: { name: 'Gemini', version: '2.0 Flash' },
        analysis,
        userNotes: '',
        tags: []
      };
      const id = await StudyService.save(uid, studyData);

      // If guest, mark trial as used and save the study ID
      if (!user) {
        GuestTrialService.markTrialUsed();
        GuestTrialService.setTrialStudyId(id);
      }

      // Enforce 10 study limit for logged-in users
      if (user) {
        await StudyService.enforceLimit(uid, 10);
      }

      clearInterval(stepInterval);
      navigate(`/study/${id}`);
    } catch (err: any) {
      clearInterval(stepInterval);
      setError("Study generation failed. Please ensure the reference is valid (e.g., 'Isaiah 53').");
    } finally {
      setLoading(false);
    }
  };

  const steps = ["Translation", "Context", "Language", "Themes", "Ready"];

  return (
    <>
      <SignInRequiredModal
        isOpen={showSignInModal}
        onClose={() => setShowSignInModal(false)}
        message="You've used your free trial study. Sign in to continue generating studies, save your progress, and access your study history."
      />

      <div className="max-w-4xl mx-auto py-20 px-4">
        <div className="text-center mb-16">
          <h1 className="text-5xl md:text-7xl font-black text-slate-900 mb-6 serif leading-tight">Your Personal <span className="text-indigo-600 underline decoration-indigo-200">Theologian.</span></h1>
          <p className="text-xl text-slate-500 max-w-2xl mx-auto font-medium leading-relaxed text-balance">Structured AI analysis of Biblical context, original languages, and practical life applications.</p>
        </div>

        {/* Guest Trial Banner */}
        {!user && (
          <div className={`max-w-xl mx-auto mb-6 p-4 rounded-2xl text-center ${canGuestGenerate ? 'bg-emerald-50 border border-emerald-100' : 'bg-amber-50 border border-amber-100'}`}>
            {canGuestGenerate ? (
              <p className="text-emerald-700 font-bold text-sm">
                <i className="fa-solid fa-gift mr-2"></i>
                Try 1 free study without signing in!
              </p>
            ) : (
              <p className="text-amber-700 font-bold text-sm">
                <i className="fa-solid fa-lock mr-2"></i>
                Free trial used. <Link to="/login" className="underline hover:text-amber-900">Sign in</Link> to continue studying.
              </p>
            )}
          </div>
        )}

        <div className="bg-white p-10 rounded-3xl shadow-2xl border border-slate-100 max-w-xl mx-auto relative overflow-hidden">
          {loading && (
            <div className="absolute inset-0 bg-white/95 z-20 rounded-3xl flex flex-col items-center justify-center p-8 text-center animate-in fade-in duration-500">
              <div className="w-20 h-20 relative mb-8">
                <div className="absolute inset-0 border-4 border-indigo-100 rounded-full"></div>
                <div className="absolute inset-0 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin"></div>
                <i className="fa-solid fa-scroll absolute inset-0 flex items-center justify-center text-2xl text-indigo-600"></i>
              </div>
              <h3 className="text-2xl font-black text-slate-800 mb-2 uppercase tracking-tighter italic">{steps[step]}</h3>
              <p className="text-slate-500 font-bold text-xs uppercase tracking-widest">Scholar is synthesizing data...</p>
            </div>
          )}

          <form onSubmit={handleAnalyze} className="space-y-8">
            <div>
              <label className="block text-sm font-black text-slate-700 mb-3 uppercase tracking-[0.2em] text-[10px]">Passage Reference</label>
              <input
                type="text"
                placeholder="e.g., Romans 8:1-11"
                className="w-full px-6 py-4 rounded-2xl border-2 border-slate-100 bg-slate-50 focus:border-indigo-600 focus:bg-white outline-none transition-all text-lg font-bold"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                required
              />
            </div>

            <div className="grid grid-cols-1 gap-6">
              <label className="block text-sm font-black text-slate-700 mb-1 uppercase tracking-[0.2em] text-[10px]">Translation</label>
              <div className="grid grid-cols-3 gap-3">
                {['ESV', 'NIV', 'KJV', 'NASB', 'NLT', 'NKJV', 'MSG', 'CSB', 'ASV'].map(t => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setTranslation(t)}
                    className={`py-3 rounded-xl border-2 font-black text-xs transition-all ${translation === t ? 'border-indigo-600 bg-indigo-50 text-indigo-700' : 'border-slate-100 text-slate-400 hover:border-slate-200'}`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>

            <button
              type="submit"
              className="w-full py-5 rounded-2xl bg-indigo-600 text-white font-black text-xl hover:bg-indigo-700 transition shadow-xl shadow-indigo-100 active:scale-95 uppercase tracking-tighter"
            >
              {!user && !canGuestGenerate ? 'Sign In to Generate' : 'Generate Deep Study'}
            </button>
          </form>
          {error && (
            <div className="mt-6 p-4 bg-red-50 border border-red-100 rounded-xl flex items-start space-x-3 text-red-600 text-xs font-bold uppercase tracking-tight">
              <i className="fa-solid fa-circle-exclamation mt-0.5"></i>
              <span>{error}</span>
            </div>
          )}
        </div>
      </div>
    </>
  );
};

const StudyDetail = () => {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [study, setStudy] = useState<SavedStudy | null>(null);
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(true);
  const [chatInput, setChatInput] = useState('');
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [chatLoading, setChatLoading] = useState(false);

  useEffect(() => {
    const fetch = async () => {
      if (!id) return;
      const data = await StudyService.getById(user?.uid || 'guest', id);
      if (data) {
        setStudy(data);
        setNotes(data.userNotes || '');
      } else {
        navigate('/history');
      }
      setLoading(false);
    };
    fetch();
  }, [id, user, navigate]);

  const saveNotes = async () => {
    if (!id) return;
    await StudyService.update(user?.uid || 'guest', id, { userNotes: notes });
    alert('Reflections saved to your library.');
  };

  const handleChat = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim() || chatLoading || !study) return;
    const msg = chatInput;
    setChatInput('');
    setChatHistory(prev => [...prev, { role: 'user', text: msg }]);
    setChatLoading(true);
    try {
      const hist = chatHistory.map(h => ({ role: h.role, parts: [{ text: h.text }] }));
      const res = await chatWithPassage(study.reference, hist, msg);
      setChatHistory(prev => [...prev, { role: 'model', text: res }]);
    } catch (e) {
      setChatHistory(prev => [...prev, { role: 'model', text: "The Scholar is currently unavailable. Try again shortly." }]);
    } finally {
      setChatLoading(false);
    }
  };

  if (loading) return <div className="p-20 text-center"><div className="w-10 h-10 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto"></div></div>;
  if (!study) return null;

  return (
    <div className="max-w-6xl mx-auto py-12 px-4 grid grid-cols-1 lg:grid-cols-3 gap-10">
      <div className="lg:col-span-2 space-y-12">
        <header className="border-b-2 border-slate-100 pb-8">
          <div className="flex justify-between items-start mb-4">
            <h1 className="text-5xl font-black text-slate-900 serif italic tracking-tighter leading-none">{study.reference}</h1>
            <button onClick={async () => { if (confirm('Delete study?')) { await StudyService.remove(user?.uid || 'guest', id!); navigate('/history'); } }} className="text-slate-300 hover:text-red-500 transition-colors"><i className="fa-solid fa-trash-can text-xl"></i></button>
          </div>
          <div className="flex items-center space-x-3">
            <span className="bg-indigo-600 text-white text-[10px] font-black px-3 py-1 rounded-full uppercase tracking-tighter">{study.translation} Analysis</span>
            <span className="text-slate-400 font-bold text-xs uppercase tracking-widest">{new Date(study.createdAt).toLocaleDateString()}</span>
          </div>
        </header>

        <section className="bg-white p-8 rounded-3xl border border-slate-200 shadow-sm leading-relaxed relative overflow-hidden">
          <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-50 rounded-full -mr-16 -mt-16 opacity-50"></div>
          <h2 className="text-xl font-black mb-6 flex items-center text-slate-800 uppercase tracking-tighter relative z-10">
            <i className="fa-solid fa-feather-pointed mr-3 text-indigo-600"></i> Analysis Summary
          </h2>
          <p className="text-slate-700 text-lg whitespace-pre-wrap leading-loose font-medium relative z-10">{study.analysis.summary}</p>
        </section>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <div className="bg-slate-50 p-8 rounded-3xl border border-slate-100">
            <h3 className="text-xs font-black mb-4 uppercase tracking-[0.2em] text-slate-400">Scholarly Context</h3>
            <div className="space-y-4 text-xs font-bold">
              <div className="flex items-center justify-between border-b border-slate-200 pb-2"><span className="text-slate-400 uppercase tracking-widest text-[9px]">Author</span><span className="text-slate-700 text-right max-w-[60%]">{study.analysis.context.author}</span></div>
              <div className="flex items-center justify-between border-b border-slate-200 pb-2"><span className="text-slate-400 uppercase tracking-widest text-[9px]">Audience</span><span className="text-slate-700 text-right max-w-[60%]">{study.analysis.context.audience}</span></div>
              <div className="flex items-center justify-between border-b border-slate-200 pb-2"><span className="text-slate-400 uppercase tracking-widest text-[9px]">Setting</span><span className="text-slate-700 text-right max-w-[60%]">{study.analysis.context.setting}</span></div>
              <div className="flex items-center justify-between pb-2"><span className="text-slate-400 uppercase tracking-widest text-[9px]">Purpose</span><span className="text-slate-700 text-right max-w-[60%]">{study.analysis.context.purpose}</span></div>
            </div>
          </div>
          <div className="bg-indigo-900 p-8 rounded-3xl text-white shadow-2xl relative overflow-hidden">
            <div className="absolute bottom-0 right-0 p-4 opacity-10"><i className="fa-solid fa-crown text-6xl"></i></div>
            <h3 className="text-xs font-black mb-4 uppercase tracking-[0.2em] text-indigo-300">Dominant Themes</h3>
            <ul className="space-y-3">
              {study.analysis.keyThemes.map((t, i) => (
                <li key={i} className="flex items-center font-bold text-xs">
                  <i className="fa-solid fa-check text-indigo-400 mr-3 text-[10px]"></i> {t}
                </li>
              ))}
            </ul>
          </div>
        </div>

        <section>
          <h2 className="text-xl font-black mb-8 flex items-center text-slate-800 uppercase tracking-tighter">
            <i className="fa-solid fa-language mr-3 text-indigo-600"></i> Original Language
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {study.analysis.languageInsights.map((ins, i) => (
              <div key={i} className="bg-gradient-to-br from-indigo-600 to-purple-700 p-6 rounded-3xl shadow-xl hover:shadow-2xl transition-all hover:scale-[1.02] relative overflow-hidden">
                <div className="absolute top-0 right-0 w-32 h-32 bg-white/5 rounded-full -mr-16 -mt-16"></div>
                <div className="absolute bottom-0 left-0 w-24 h-24 bg-white/5 rounded-full -ml-12 -mb-12"></div>

                {/* Language Badge */}
                <div className="flex justify-between items-start mb-4 relative z-10">
                  <span className="bg-white/20 text-white text-[10px] font-black px-3 py-1 rounded-full uppercase tracking-wider backdrop-blur-sm">
                    {ins.language}
                  </span>
                  {ins.strongs && (
                    <span className="text-white/60 text-[9px] font-mono">{ins.strongs}</span>
                  )}
                </div>

                {/* Main Greek/Hebrew Word - PROMINENT */}
                <div className="text-center mb-4 relative z-10">
                  <p className="text-4xl md:text-5xl font-black text-white mb-2 tracking-wide" style={{fontFamily: 'serif'}}>
                    {ins.term}
                  </p>
                  <p className="text-white/70 text-sm font-bold italic tracking-wider">
                    {ins.transliteration}
                  </p>
                </div>

                {/* Meaning */}
                <div className="bg-white/10 backdrop-blur-sm rounded-2xl p-4 mb-3 relative z-10">
                  <p className="text-[9px] font-black text-white/50 uppercase tracking-widest mb-1">Meaning</p>
                  <p className="text-white font-bold text-sm leading-relaxed">{ins.meaning}</p>
                </div>

                {/* Why It Matters */}
                <div className="relative z-10">
                  <p className="text-[9px] font-black text-white/50 uppercase tracking-widest mb-1">Significance</p>
                  <p className="text-white/80 text-xs italic leading-relaxed">"{ins.whyItMatters}"</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="bg-emerald-50 p-10 rounded-3xl border border-emerald-100 shadow-inner">
          <h2 className="text-xl font-black mb-6 text-emerald-900 uppercase tracking-tighter flex items-center">
            <i className="fa-solid fa-compass mr-3"></i> Practical Walk
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {study.analysis.application.map((app, i) => (
              <div key={i} className="flex space-x-4">
                <div className="w-8 h-8 rounded-full bg-emerald-600 text-white flex items-center justify-center font-black flex-shrink-0 text-[10px] shadow-lg shadow-emerald-200">{i + 1}</div>
                <p className="text-emerald-950 font-bold text-sm leading-relaxed">{app}</p>
              </div>
            ))}
          </div>
        </section>
      </div>

      <aside className="space-y-8">
        <div className="bg-white p-8 rounded-3xl border border-slate-200 shadow-xl sticky top-28">
          <h3 className="text-xs font-black mb-4 flex items-center uppercase tracking-[0.2em] text-slate-800">
            <i className="fa-solid fa-pen-nib mr-2 text-indigo-600"></i> Personal Journal
          </h3>
          <textarea
            className="w-full h-48 p-5 bg-slate-50 border-2 border-slate-100 rounded-2xl focus:bg-white focus:border-indigo-600 outline-none transition-all resize-none text-sm font-medium"
            placeholder="Record your personal insights and prayers regarding this study..."
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          ></textarea>
          <button onClick={saveNotes} className="w-full mt-4 bg-indigo-600 text-white py-3 rounded-2xl font-black text-xs uppercase tracking-widest shadow-lg shadow-indigo-100 hover:bg-indigo-700 transition">Save Reflection</button>

          <div className="my-10 border-t border-slate-100"></div>

          <h3 className="text-xs font-black mb-4 flex items-center uppercase tracking-[0.2em] text-slate-800">
            <i className="fa-solid fa-comments mr-2 text-indigo-600"></i> Interactive Scholar
          </h3>
          {user ? (
            <>
              <div className="h-64 overflow-y-auto space-y-4 pr-2 mb-4 scrollbar-thin">
                {chatHistory.length === 0 && <p className="text-slate-400 text-[10px] text-center py-12 font-black uppercase tracking-widest italic">No active inquiries</p>}
                {chatHistory.map((m, i) => (
                  <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[85%] px-4 py-3 rounded-2xl font-bold text-[11px] leading-relaxed shadow-sm ${m.role === 'user' ? 'bg-indigo-600 text-white rounded-tr-none' : 'bg-slate-100 text-slate-700 rounded-tl-none border border-slate-200'}`}>{m.text}</div>
                  </div>
                ))}
                {chatLoading && <div className="text-slate-400 text-[9px] font-black uppercase animate-pulse italic tracking-[0.2em]">Consulting Commentaries...</div>}
              </div>
              <form onSubmit={handleChat} className="relative">
                <input type="text" placeholder="Ask follow-up question..." className="w-full py-3 pl-4 pr-12 bg-slate-50 border-2 border-slate-100 rounded-xl focus:bg-white focus:border-indigo-600 outline-none transition-all text-xs font-bold" value={chatInput} onChange={e => setChatInput(e.target.value)} />
                <button type="submit" className="absolute right-3 top-2.5 text-indigo-600"><i className="fa-solid fa-paper-plane"></i></button>
              </form>
            </>
          ) : (
            <div className="text-center py-8">
              <div className="w-16 h-16 bg-indigo-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <i className="fa-solid fa-lock text-indigo-600 text-2xl"></i>
              </div>
              <p className="text-slate-600 font-bold text-sm mb-2">Sign in to chat with the Scholar</p>
              <p className="text-slate-400 text-xs mb-4">Ask follow-up questions and dive deeper into this passage</p>
              <a href="#/login" className="inline-block bg-indigo-600 text-white px-6 py-2 rounded-xl font-black text-xs uppercase tracking-widest hover:bg-indigo-700 transition">
                <i className="fa-solid fa-right-to-bracket mr-2"></i>Sign In
              </a>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
};

const History = () => {
  const { user } = useAuth();
  const [studies, setStudies] = useState<SavedStudy[]>([]);
  const [loading, setLoading] = useState(true);
  const [clearing, setClearing] = useState(false);

  useEffect(() => {
    const fetch = async () => {
      const data = await StudyService.getAll(user?.uid || 'guest');
      setStudies(data);
      setLoading(false);
    };
    fetch();
  }, [user]);

  const handleClearAll = async () => {
    if (!confirm('Are you sure you want to delete ALL your studies? This cannot be undone.')) return;
    setClearing(true);
    try {
      await StudyService.clearAll(user?.uid || 'guest');
      setStudies([]);
    } catch (e) {
      alert('Failed to clear history. Please try again.');
    } finally {
      setClearing(false);
    }
  };

  if (loading) return <div className="p-20 text-center"><div className="w-10 h-10 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto"></div></div>;

  return (
    <div className="max-w-6xl mx-auto py-16 px-4">
      <div className="mb-12 border-b-2 border-slate-100 pb-6 flex justify-between items-end">
        <div>
          <h1 className="text-4xl font-black text-slate-900 serif italic tracking-tighter">Study Library</h1>
          <p className="text-slate-400 font-bold text-xs uppercase tracking-widest mt-1">Your isolated repository of theological insights. Limited to 10 studies.</p>
        </div>
        {studies.length > 0 && (
          <button
            onClick={handleClearAll}
            disabled={clearing}
            className="bg-red-50 hover:bg-red-100 text-red-600 px-4 py-2 rounded-xl font-black text-[10px] uppercase tracking-widest transition border border-red-100 disabled:opacity-50"
          >
            {clearing ? (
              <span className="flex items-center space-x-2">
                <div className="w-3 h-3 border-2 border-red-400 border-t-transparent rounded-full animate-spin"></div>
                <span>Clearing...</span>
              </span>
            ) : (
              <span className="flex items-center space-x-2">
                <i className="fa-solid fa-trash-can"></i>
                <span>Clear All</span>
              </span>
            )}
          </button>
        )}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8">
        {studies.length > 0 ? studies.map(s => (
          <div key={s.id} className="bg-white p-8 rounded-[2rem] border border-slate-200 shadow-sm hover:shadow-2xl transition-all group relative overflow-hidden">
            <div className="absolute top-0 right-0 w-24 h-24 bg-indigo-50 rounded-full -mr-12 -mt-12 group-hover:bg-indigo-600 transition-colors"></div>
            <div className="flex justify-between items-start mb-6 relative z-10">
              <h3 className="text-2xl font-black text-slate-800 group-hover:text-indigo-600 transition-colors serif tracking-tighter">{s.reference}</h3>
              <span className="text-[9px] font-black bg-slate-100 text-slate-400 px-2 py-1 rounded uppercase tracking-tighter">{s.translation}</span>
            </div>
            <p className="text-slate-500 text-xs line-clamp-3 mb-6 font-bold leading-relaxed italic relative z-10">"{s.analysis.summary}"</p>
            <Link to={`/study/${s.id}`} className="inline-flex items-center text-indigo-600 font-black text-[10px] uppercase tracking-widest hover:underline relative z-10">
              Open Volume <i className="fa-solid fa-arrow-right ml-2"></i>
            </Link>
          </div>
        )) : (
          <div className="col-span-full py-24 text-center border-2 border-dashed border-slate-200 rounded-[3rem] bg-white">
            <div className="bg-slate-50 w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-6 text-slate-200"><i className="fa-solid fa-book-open text-3xl"></i></div>
            <p className="text-slate-400 font-black text-lg mb-4 uppercase tracking-tighter">Your library is empty.</p>
            <Link to="/" className="inline-block bg-indigo-600 text-white px-10 py-4 rounded-2xl font-black text-xs uppercase tracking-widest shadow-lg shadow-indigo-100 hover:bg-indigo-700 transition">Begin First Study</Link>
          </div>
        )}
      </div>
    </div>
  );
};

const AdminDashboard = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [studies, setStudies] = useState<{ study: SavedStudy; userEmail: string; userName: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [stats, setStats] = useState({ totalStudies: 0, totalUsers: 0, translations: {} as Record<string, number> });

  useEffect(() => {
    const checkAndFetch = async () => {
      if (!user) {
        navigate('/login');
        return;
      }

      const adminStatus = await AdminService.checkIsAdmin(user.uid);
      setIsAdmin(adminStatus);

      if (!adminStatus) {
        setLoading(false);
        return;
      }

      const allStudies = await AdminService.getAllStudies();
      setStudies(allStudies);

      // Calculate stats
      const uniqueUsers = new Set(allStudies.map(s => s.study.userId));
      const translationCounts: Record<string, number> = {};
      allStudies.forEach(s => {
        translationCounts[s.study.translation] = (translationCounts[s.study.translation] || 0) + 1;
      });

      setStats({
        totalStudies: allStudies.length,
        totalUsers: uniqueUsers.size,
        translations: translationCounts
      });

      setLoading(false);
    };
    checkAndFetch();
  }, [user, navigate]);

  const filteredStudies = studies.filter(s =>
    s.study.reference.toLowerCase().includes(searchTerm.toLowerCase()) ||
    s.userEmail.toLowerCase().includes(searchTerm.toLowerCase()) ||
    s.userName.toLowerCase().includes(searchTerm.toLowerCase())
  );

  if (loading) {
    return (
      <div className="p-20 text-center">
        <div className="w-10 h-10 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto"></div>
        <p className="mt-4 text-slate-400 text-xs font-bold uppercase tracking-widest">Verifying credentials...</p>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="max-w-2xl mx-auto py-20 px-4 text-center">
        <div className="bg-red-50 p-12 rounded-3xl border border-red-100">
          <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-6">
            <i className="fa-solid fa-lock text-red-500 text-2xl"></i>
          </div>
          <h2 className="text-2xl font-black text-red-900 mb-4 uppercase tracking-tighter">Access Denied</h2>
          <p className="text-red-600 font-bold text-sm mb-6">You do not have administrator privileges to view this page.</p>
          <Link to="/" className="inline-block bg-slate-800 text-white px-8 py-3 rounded-xl font-bold text-xs uppercase tracking-widest hover:bg-slate-900 transition">
            Return Home
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto py-12 px-4">
      {/* Header */}
      <div className="mb-10 border-b-2 border-slate-100 pb-6">
        <div className="flex items-center space-x-3 mb-2">
          <div className="bg-amber-500 p-2 rounded-xl">
            <i className="fa-solid fa-crown text-white"></i>
          </div>
          <h1 className="text-4xl font-black text-slate-900 serif italic tracking-tighter">Admin Dashboard</h1>
        </div>
        <p className="text-slate-400 font-bold text-xs uppercase tracking-widest">View and manage all scripture studies across all users</p>
      </div>

      {/* AI Configuration Card */}
      <div className="bg-gradient-to-r from-violet-50 to-purple-50 p-6 rounded-2xl border border-violet-200 shadow-sm mb-10">
        <div className="flex items-center space-x-3 mb-4">
          <div className="w-10 h-10 bg-violet-600 rounded-xl flex items-center justify-center">
            <i className="fa-solid fa-microchip text-white"></i>
          </div>
          <div>
            <h3 className="text-lg font-black text-violet-900 uppercase tracking-tight">AI Configuration</h3>
            <p className="text-violet-500 text-[10px] font-bold uppercase tracking-widest">Current model and API status</p>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-white p-4 rounded-xl border border-violet-100">
            <p className="text-slate-400 text-[10px] font-black uppercase tracking-widest mb-1">AI Provider</p>
            <p className="text-violet-700 font-black text-lg">Google Gemini</p>
          </div>
          <div className="bg-white p-4 rounded-xl border border-violet-100">
            <p className="text-slate-400 text-[10px] font-black uppercase tracking-widest mb-1">Model</p>
            <p className="text-violet-700 font-black text-lg">Gemini 2.0 Flash</p>
            <p className="text-emerald-500 text-[9px] font-bold uppercase tracking-wider mt-1">Free Tier</p>
          </div>
          <div className="bg-white p-4 rounded-xl border border-violet-100">
            <p className="text-slate-400 text-[10px] font-black uppercase tracking-widest mb-1">API Key Status</p>
            {process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'undefined' && process.env.GEMINI_API_KEY.length > 10 ? (
              <div className="flex items-center space-x-2">
                <div className="w-3 h-3 bg-emerald-500 rounded-full animate-pulse"></div>
                <p className="text-emerald-600 font-black text-sm">Configured</p>
              </div>
            ) : (
              <div className="flex items-center space-x-2">
                <div className="w-3 h-3 bg-red-500 rounded-full"></div>
                <p className="text-red-600 font-black text-sm">Not Configured</p>
              </div>
            )}
            <p className="text-slate-400 text-[9px] font-bold mt-1 truncate">
              {process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'undefined' ? `Key: ${process.env.GEMINI_API_KEY.slice(0, 15)}...` : 'No key found'}
            </p>
          </div>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-10">
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-slate-400 text-[10px] font-black uppercase tracking-widest">Total Studies</p>
              <p className="text-3xl font-black text-slate-900">{stats.totalStudies}</p>
            </div>
            <div className="w-12 h-12 bg-indigo-100 rounded-xl flex items-center justify-center">
              <i className="fa-solid fa-book-bible text-indigo-600"></i>
            </div>
          </div>
        </div>

        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-slate-400 text-[10px] font-black uppercase tracking-widest">Total Users</p>
              <p className="text-3xl font-black text-slate-900">{stats.totalUsers}</p>
            </div>
            <div className="w-12 h-12 bg-emerald-100 rounded-xl flex items-center justify-center">
              <i className="fa-solid fa-users text-emerald-600"></i>
            </div>
          </div>
        </div>

        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm col-span-1 md:col-span-2">
          <p className="text-slate-400 text-[10px] font-black uppercase tracking-widest mb-3">Translations Used</p>
          <div className="flex flex-wrap gap-2">
            {Object.entries(stats.translations).map(([trans, count]) => (
              <span key={trans} className="bg-slate-100 text-slate-700 px-3 py-1 rounded-full text-xs font-bold">
                {trans}: {count}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Search */}
      <div className="mb-8">
        <div className="relative max-w-md">
          <i className="fa-solid fa-search absolute left-4 top-1/2 -translate-y-1/2 text-slate-300"></i>
          <input
            type="text"
            placeholder="Search by reference, user name, or email..."
            className="w-full pl-12 pr-4 py-3 bg-white border-2 border-slate-100 rounded-xl focus:border-indigo-600 outline-none transition text-sm font-bold"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
      </div>

      {/* Studies Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="text-left px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Reference</th>
                <th className="text-left px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">User</th>
                <th className="text-left px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Translation</th>
                <th className="text-left px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Date</th>
                <th className="text-left px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Summary</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredStudies.length > 0 ? filteredStudies.map(({ study, userEmail, userName }) => (
                <tr key={`${study.userId}-${study.id}`} className="hover:bg-slate-50 transition-colors">
                  <td className="px-6 py-4">
                    <span className="text-slate-900 font-black text-sm">{study.reference}</span>
                  </td>
                  <td className="px-6 py-4">
                    <div>
                      <p className="text-slate-800 font-bold text-xs">{userName}</p>
                      <p className="text-slate-400 text-[10px]">{userEmail}</p>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <span className="bg-indigo-100 text-indigo-700 text-[10px] font-black px-2 py-1 rounded uppercase">{study.translation}</span>
                  </td>
                  <td className="px-6 py-4">
                    <span className="text-slate-500 text-xs font-bold">{new Date(study.createdAt).toLocaleDateString()}</span>
                  </td>
                  <td className="px-6 py-4 max-w-xs">
                    <p className="text-slate-500 text-xs line-clamp-2 italic">"{study.analysis?.summary?.slice(0, 100)}..."</p>
                  </td>
                </tr>
              )) : (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center">
                    <p className="text-slate-400 font-bold text-sm">
                      {searchTerm ? 'No studies match your search.' : 'No studies found in the database.'}
                    </p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {filteredStudies.length > 0 && (
          <div className="px-6 py-4 bg-slate-50 border-t border-slate-200">
            <p className="text-slate-400 text-xs font-bold">
              Showing {filteredStudies.length} of {studies.length} studies
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

const Login = () => {
  const navigate = useNavigate();

  const handleGoogle = async () => {
    if (!isFirebaseConfigured || !auth) {
      alert("Social auth requires Firebase keys. Use our 'Guest Mode' to explore locally.");
      return;
    }
    const provider = new GoogleAuthProvider();
    try {
      const result = await signInWithPopup(auth, provider);
      const user = result.user;
      console.log("Logged in as:", user.displayName);
      await syncUserProfile(user);
      navigate('/');
    } catch (e: any) {
      console.error("Login failed:", e.message);
      alert("Login Error: " + e.message);
    }
  };

  return (
    <div className="min-h-[80vh] flex items-center justify-center p-4">
      <div className="bg-white p-12 rounded-[3rem] shadow-2xl border border-slate-100 max-w-md w-full text-center relative overflow-hidden">
        <div className="absolute top-0 left-0 w-full h-2 bg-indigo-600"></div>
        <div className="w-16 h-16 bg-indigo-600 rounded-2xl flex items-center justify-center text-white text-3xl mx-auto mb-8 shadow-xl shadow-indigo-100 transition-transform hover:rotate-6">
          <i className="fa-solid fa-scroll"></i>
        </div>
        <h2 className="text-3xl font-black text-slate-900 serif mb-4 italic tracking-tighter">Enter the Library</h2>
        <p className="text-slate-500 font-bold text-xs uppercase tracking-widest mb-10 leading-relaxed">Persist your theological journey across devices.</p>

        <button onClick={handleGoogle} className="group w-full py-4 border-2 border-slate-100 rounded-2xl flex items-center justify-center space-x-3 font-black text-slate-700 hover:bg-slate-50 hover:border-slate-200 transition mb-4 shadow-sm">
          <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" className="w-5 h-5 group-hover:scale-110 transition-transform" alt="Google" />
          <span className="text-xs uppercase tracking-widest">Continue with Google</span>
        </button>

        <button onClick={() => navigate('/')} className="w-full py-4 text-slate-400 font-black hover:text-indigo-600 transition text-[10px] uppercase tracking-[0.2em] underline decoration-slate-200 underline-offset-4">Continue as Guest</button>

        <div className="mt-12 pt-8 border-t border-slate-50">
          <p className="text-[10px] text-slate-300 font-black uppercase tracking-widest italic text-balance">Production-Ready MVP • Secure Theological Research</p>
        </div>
      </div>
    </div>
  );
};

const App = () => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isFirebaseConfigured || !auth) {
      setLoading(false);
      return;
    }
    const unsub = onAuthStateChanged(auth, u => {
      setUser(u);
      setLoading(false);
    });
    return unsub;
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading }}>
      <HashRouter>
        <div className="min-h-screen bg-slate-50 flex flex-col selection:bg-indigo-100 selection:text-indigo-900">
          <Navbar />
          <main className="flex-grow">
            <Routes>
              <Route path="/login" element={<Login />} />
              <Route path="/" element={<Landing />} />
              <Route path="/history" element={<AuthRequiredRoute><History /></AuthRequiredRoute>} />
              <Route path="/study/:id" element={<StudyDetail />} />
              <Route path="/admin" element={<ProtectedRoute><AdminDashboard /></ProtectedRoute>} />
              <Route path="*" element={<Navigate to="/" />} />
            </Routes>
          </main>
          <footer className="py-12 bg-white border-t border-slate-100 text-center">
            <p className="text-slate-300 font-black text-[9px] uppercase tracking-[0.3em] mb-4 italic">Collaborative Scholarship with Holy Scriptures</p>
            <p className="text-slate-400 text-[10px] font-black uppercase tracking-widest">&copy; {new Date().getFullYear()} Scripture Scholar Bible App</p>
            <div className="flex justify-center space-x-6 mt-6 opacity-30">
              <i className="fa-brands fa-google"></i>
              <i className="fa-solid fa-cloud"></i>
              <i className="fa-solid fa-brain"></i>
            </div>
          </footer>
        </div>
      </HashRouter>
    </AuthContext.Provider>
  );
};

export default App;
