/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo } from 'react';
import { 
  Calendar as CalendarIcon, 
  Plus, 
  Trash2, 
  Users, 
  ChevronLeft, 
  ChevronRight,
  Check,
  X,
  Beer
} from 'lucide-react';
import { 
  format, 
  addMonths, 
  subMonths, 
  startOfMonth, 
  endOfMonth, 
  startOfWeek, 
  endOfWeek, 
  isSameMonth, 
  isSameDay, 
  addDays, 
  eachDayOfInterval,
  isToday,
  parseISO
} from 'date-fns';
import { motion, AnimatePresence } from 'motion/react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

// Utility for tailwind classes
function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface Vote {
  id: number;
  date_id: number;
  user_name: string;
}

interface AppointmentDate {
  id: number;
  appointment_id: number;
  date: string;
  vote_count: number;
  voters: string | null;
}

interface Appointment {
  id: number;
  title: string;
  created_at: string;
  dates?: AppointmentDate[];
}

export default function App() {
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [selectedAppointment, setSelectedAppointment] = useState<Appointment | null>(null);
  const [userName, setUserName] = useState<string>(localStorage.getItem('voter_name') || '');
  const [newAppointmentTitle, setNewAppointmentTitle] = useState('');
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);

  // Fetch appointments list
  const fetchAppointments = async () => {
    const res = await fetch('/api/appointments');
    const data = await res.json();
    setAppointments(data);
  };

  // Fetch specific appointment details
  const fetchAppointmentDetails = async (id: number) => {
    const res = await fetch(`/api/appointments/${id}`);
    const data = await res.json();
    setSelectedAppointment(data);
  };

  useEffect(() => {
    fetchAppointments();

    // WebSocket for real-time
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}`);

    ws.onmessage = (event) => {
      const { type, payload } = JSON.parse(event.data);
      
      // Use a functional update or a way to get the latest state if needed, 
      // but here we can just check the payload and trigger fetches.
      if (type === 'APPOINTMENT_CREATED' || type === 'APPOINTMENT_DELETED') {
        fetchAppointments();
      } 
      
      // We always fetch details if the payload matches the current selection
      // To avoid stale closures, we can use the state setter's functional update 
      // to check the current ID, but since we want to trigger a fetch, 
      // we'll just use a ref-like approach or a more robust effect.
    };

    return () => ws.close();
  }, []);

  // Separate effect to handle specific appointment updates to avoid stale closures
  useEffect(() => {
    if (!selectedAppointment?.id) return;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}`);

    ws.onmessage = (event) => {
      const { type, payload } = JSON.parse(event.data);
      if (
        (type === 'DATE_ADDED' || type === 'VOTE_UPDATED' || type === 'DATE_REMOVED') && 
        payload.appointmentId === selectedAppointment.id
      ) {
        fetchAppointmentDetails(selectedAppointment.id);
      }
      if (type === 'APPOINTMENT_DELETED' && payload.id === selectedAppointment.id) {
        setSelectedAppointment(null);
      }
    };

    return () => ws.close();
  }, [selectedAppointment?.id]);

  const handleCreateAppointment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAppointmentTitle.trim()) return;
    const res = await fetch('/api/appointments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: newAppointmentTitle }),
    });
    if (res.ok) {
      setNewAppointmentTitle('');
    }
  };

  const handleDeleteAppointment = async (id: number) => {
    if (!confirm('Bạn có chắc muốn xoá buổi hẹn này?')) return;
    await fetch(`/api/appointments/${id}`, { method: 'DELETE' });
  };

  const handleAddDate = async (date: Date) => {
    if (!selectedAppointment) return;
    const dateStr = format(date, 'yyyy-MM-dd');
    const res = await fetch(`/api/appointments/${selectedAppointment.id}/dates`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date: dateStr }),
    });
    if (!res.ok) {
      alert('Ngày này đã có trong danh sách!');
    }
  };

  const handleRemoveDate = async (dateId: number) => {
    if (!selectedAppointment) return;
    
    const dateToRemove = selectedAppointment.dates?.find(d => d.id === dateId);
    
    // Optimistic update
    setSelectedAppointment(prev => {
      if (!prev) return null;
      return {
        ...prev,
        dates: prev.dates?.filter(d => d.id !== dateId)
      };
    });

    const res = await fetch(`/api/appointments/${selectedAppointment.id}/dates/${dateId}`, {
      method: 'DELETE'
    });

    if (!res.ok) {
      fetchAppointmentDetails(selectedAppointment.id);
      alert('Không thể xoá ngày này. Vui lòng thử lại.');
    } else if (dateToRemove && selectedDate && isSameDay(parseISO(dateToRemove.date), selectedDate)) {
      setSelectedDate(null);
    }
  };

  const handleVote = async (dateId: number) => {
    if (!userName.trim()) {
      alert('Vui lòng nhập tên của bạn!');
      return;
    }
    localStorage.setItem('voter_name', userName);

    // Optimistic update
    setSelectedAppointment(prev => {
      if (!prev) return null;
      return {
        ...prev,
        dates: prev.dates?.map(d => {
          if (d.id === dateId) {
            const currentVoters = d.voters ? d.voters.split(',') : [];
            if (!currentVoters.includes(userName)) {
              return {
                ...d,
                vote_count: d.vote_count + 1,
                voters: [...currentVoters, userName].join(',')
              };
            }
          }
          return d;
        })
      };
    });

    const res = await fetch('/api/votes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dateId, userName, appointmentId: selectedAppointment?.id }),
    });

    if (!res.ok) {
      fetchAppointmentDetails(selectedAppointment!.id);
    }
  };

  const handleUnvote = async (dateId: number) => {
    if (!userName.trim()) return;

    // Optimistic update
    setSelectedAppointment(prev => {
      if (!prev) return null;
      return {
        ...prev,
        dates: prev.dates?.map(d => {
          if (d.id === dateId) {
            const currentVoters = d.voters ? d.voters.split(',') : [];
            if (currentVoters.includes(userName)) {
              return {
                ...d,
                vote_count: Math.max(0, d.vote_count - 1),
                voters: currentVoters.filter(v => v !== userName).join(',')
              };
            }
          }
          return d;
        })
      };
    });

    const res = await fetch('/api/votes', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dateId, userName, appointmentId: selectedAppointment?.id }),
    });

    if (!res.ok) {
      fetchAppointmentDetails(selectedAppointment!.id);
    }
  };

  // Calendar Logic
  const days = useMemo(() => {
    const start = startOfWeek(startOfMonth(currentMonth));
    const end = endOfWeek(endOfMonth(currentMonth));
    return eachDayOfInterval({ start, end });
  }, [currentMonth]);

  // Relative Vote Levels Logic
  const maxVotes = useMemo(() => {
    if (!selectedAppointment?.dates) return 0;
    return Math.max(0, ...selectedAppointment.dates.map(d => d.vote_count));
  }, [selectedAppointment?.dates]);

  const getVoteLevel = (count: number) => {
    if (count === 0 || maxVotes === 0) return '';
    const ratio = count / maxVotes;
    if (ratio <= 0.33) return 'bg-emerald-100 text-emerald-700 border-emerald-200';
    if (ratio <= 0.66) return 'bg-emerald-300 text-emerald-900 border-emerald-400';
    return 'bg-emerald-500 text-white border-emerald-600';
  };

  const votedDates = useMemo(() => {
    if (!selectedAppointment?.dates) return [];
    return selectedAppointment.dates
      .filter(d => d.vote_count > 0)
      .sort((a, b) => b.vote_count - a.vote_count);
  }, [selectedAppointment?.dates]);

  return (
    <div className="min-h-screen bg-[#F5F5F0] text-[#141414] font-sans p-4 md:p-8">
      <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-8">
        
        {/* Sidebar: Appointments List */}
        <div className="lg:col-span-4 space-y-6">
          <div className="bg-white rounded-2xl p-6 shadow-sm border border-black/5">
            <div className="flex items-center gap-2 mb-6">
              <Beer className="w-6 h-6 text-emerald-600" />
              <h1 className="text-xl font-bold tracking-tight">Lịch Nhậu</h1>
            </div>

            <form onSubmit={handleCreateAppointment} className="mb-6">
              <div className="relative">
                <input
                  type="text"
                  placeholder="Tên buổi hẹn mới..."
                  className="w-full pl-4 pr-12 py-3 bg-[#F5F5F0] rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-all"
                  value={newAppointmentTitle}
                  onChange={(e) => setNewAppointmentTitle(e.target.value)}
                />
                <button 
                  type="submit"
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors"
                >
                  <Plus size={18} />
                </button>
              </div>
            </form>

            <div className="space-y-2 max-h-[40vh] overflow-y-auto pr-2 custom-scrollbar">
              <AnimatePresence mode="popLayout">
                {appointments.map((app) => (
                  <motion.div
                    key={app.id}
                    layout
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    onClick={() => fetchAppointmentDetails(app.id)}
                    className={cn(
                      "group flex items-center justify-between p-4 rounded-xl cursor-pointer transition-all border",
                      selectedAppointment?.id === app.id 
                        ? "bg-emerald-50 border-emerald-200" 
                        : "bg-white border-transparent hover:bg-[#F5F5F0]"
                    )}
                  >
                    <div className="flex items-center gap-3">
                      <div className={cn(
                        "w-10 h-10 rounded-full flex items-center justify-center",
                        selectedAppointment?.id === app.id ? "bg-emerald-600 text-white" : "bg-[#F5F5F0] text-gray-500"
                      )}>
                        <CalendarIcon size={20} />
                      </div>
                      <div>
                        <h3 className="font-semibold text-sm">{app.title}</h3>
                        <p className="text-xs text-gray-400">{format(parseISO(app.created_at), 'dd/MM/yyyy')}</p>
                      </div>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteAppointment(app.id);
                      }}
                      className="opacity-0 group-hover:opacity-100 p-2 text-gray-400 hover:text-red-500 transition-all"
                    >
                      <Trash2 size={16} />
                    </button>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          </div>

          {/* Voted Dates List */}
          {selectedAppointment && votedDates.length > 0 && (
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-white rounded-2xl p-6 shadow-sm border border-black/5"
            >
              <h3 className="text-sm font-bold uppercase tracking-wider text-gray-400 mb-4 flex items-center gap-2">
                <Check size={14} className="text-emerald-600" />
                Ngày được đề xuất
              </h3>
              <div className="space-y-3">
                {votedDates.map((d) => (
                  <div key={d.id} className="flex items-center justify-between p-3 bg-[#F5F5F0] rounded-xl">
                    <div>
                      <p className="text-sm font-bold">{format(parseISO(d.date), 'dd/MM/yyyy')}</p>
                      <p className="text-[10px] text-gray-500 truncate max-w-[150px]">{d.voters}</p>
                    </div>
                    <div className={cn(
                      "px-2 py-1 rounded-lg text-xs font-bold border",
                      getVoteLevel(d.vote_count)
                    )}>
                      {d.vote_count} vote
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>
          )}
        </div>

        {/* Main Content: Calendar & Voting */}
        <div className="lg:col-span-8">
          {selectedAppointment ? (
            <motion.div 
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              className="space-y-6"
            >
              {/* Header & User Info */}
              <div className="bg-white rounded-2xl p-6 shadow-sm border border-black/5 flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                  <h2 className="text-2xl font-bold">{selectedAppointment.title}</h2>
                  <p className="text-sm text-gray-500">Chọn ngày và nhập tên để vote</p>
                </div>
                <div className="flex items-center gap-3">
                  <div className="relative">
                    <Users className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
                    <input
                      type="text"
                      placeholder="Tên của bạn..."
                      className="pl-10 pr-4 py-2 bg-[#F5F5F0] rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm"
                      value={userName}
                      onChange={(e) => setUserName(e.target.value)}
                    />
                  </div>
                </div>
              </div>

              {/* Calendar Grid */}
              <div className="bg-white rounded-2xl p-6 shadow-sm border border-black/5">
                <div className="flex items-center justify-between mb-8">
                  <h3 className="text-lg font-bold">{format(currentMonth, 'MMMM yyyy')}</h3>
                  <div className="flex gap-2">
                    <button 
                      onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}
                      className="p-2 hover:bg-[#F5F5F0] rounded-lg transition-colors"
                    >
                      <ChevronLeft size={20} />
                    </button>
                    <button 
                      onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}
                      className="p-2 hover:bg-[#F5F5F0] rounded-lg transition-colors"
                    >
                      <ChevronRight size={20} />
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-7 gap-px bg-gray-100 rounded-xl overflow-hidden border border-gray-100">
                  {['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'].map(day => (
                    <div key={day} className="bg-white py-3 text-center text-xs font-bold text-gray-400 uppercase tracking-wider">
                      {day}
                    </div>
                  ))}
                  {days.map((day, i) => {
                    const dateStr = format(day, 'yyyy-MM-dd');
                    const appDate = selectedAppointment.dates?.find(d => d.date === dateStr);
                    const isSelected = selectedDate && isSameDay(day, selectedDate);
                    const isCurrentMonth = isSameMonth(day, currentMonth);
                    
                    return (
                      <div
                        key={i}
                        onClick={() => {
                          setSelectedDate(day);
                          if (!appDate) handleAddDate(day);
                        }}
                        className={cn(
                          "relative h-24 md:h-32 bg-white p-2 cursor-pointer transition-all hover:z-10 group/cell",
                          !isCurrentMonth && "bg-gray-50/50 opacity-40",
                          isSelected && "ring-2 ring-emerald-500 ring-inset z-20"
                        )}
                      >
                        <div className="flex justify-between items-start">
                          <span className={cn(
                            "text-sm font-medium w-7 h-7 flex items-center justify-center rounded-full",
                            isToday(day) && "bg-emerald-600 text-white",
                            !isToday(day) && isCurrentMonth && "text-gray-900",
                            !isCurrentMonth && "text-gray-400"
                          )}>
                            {format(day, 'd')}
                          </span>
                          {appDate && (
                            <div className={cn(
                              "text-[10px] px-1.5 py-0.5 rounded-full font-bold border",
                              getVoteLevel(appDate.vote_count) || "bg-gray-100 text-gray-500 border-gray-200"
                            )}>
                              {appDate.vote_count} vote
                            </div>
                          )}
                        </div>

                        {appDate && (
                          <div className="mt-2 space-y-1 overflow-hidden">
                            <div className="flex flex-wrap gap-1">
                              {appDate.voters?.split(',').slice(0, 3).map((voter, idx) => (
                                <span key={idx} className="text-[10px] bg-gray-100 px-1 rounded text-gray-600 truncate max-w-full">
                                  {voter}
                                </span>
                              ))}
                              {(appDate.voters?.split(',').length || 0) > 3 && (
                                <span className="text-[10px] text-gray-400">...</span>
                              )}
                            </div>
                            
                            <div className="absolute bottom-2 right-2 flex gap-1 opacity-0 group-hover/cell:opacity-100 transition-opacity">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleRemoveDate(appDate.id);
                                }}
                                className="p-1.5 bg-gray-100 text-gray-400 rounded-lg hover:bg-red-50 hover:text-red-500 transition-colors"
                                title="Bỏ chọn ngày"
                              >
                                <Trash2 size={14} />
                              </button>
                              {appDate.voters?.split(',').includes(userName) ? (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleUnvote(appDate.id);
                                  }}
                                  className="p-1.5 bg-red-50 text-red-600 rounded-lg hover:bg-red-100 transition-colors"
                                  title="Huỷ vote"
                                >
                                  <X size={14} />
                                </button>
                              ) : (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleVote(appDate.id);
                                  }}
                                  className="p-1.5 bg-emerald-50 text-emerald-600 rounded-lg hover:bg-emerald-100 transition-colors"
                                  title="Vote"
                                >
                                  <Check size={14} />
                                </button>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                
                {/* Legend */}
                <div className="mt-6 flex items-center gap-4 text-xs text-gray-500">
                  <div className="flex items-center gap-1.5">
                    <div className="w-3 h-3 rounded bg-emerald-100 border border-emerald-200"></div>
                    <span>Thấp (≤33% max)</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className="w-3 h-3 rounded bg-emerald-300 border border-emerald-400"></div>
                    <span>Trung bình (≤66% max)</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className="w-3 h-3 rounded bg-emerald-500 border border-emerald-600"></div>
                    <span>Cao (&gt;66% max)</span>
                  </div>
                </div>
              </div>

              {/* Selected Date Details */}
              {selectedDate && (
                <motion.div 
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="bg-white rounded-2xl p-6 shadow-sm border border-black/5"
                >
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="font-bold">Chi tiết ngày {format(selectedDate, 'dd/MM/yyyy')}</h3>
                    <button onClick={() => setSelectedDate(null)} className="text-gray-400 hover:text-gray-600">
                      <X size={20} />
                    </button>
                  </div>
                  
                  {selectedAppointment.dates?.find(d => d.date === format(selectedDate, 'yyyy-MM-dd')) ? (
                    <div className="space-y-4">
                      <div className="flex items-center gap-2 text-sm text-gray-600">
                        <Users size={16} />
                        <span>Danh sách người đã vote:</span>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {selectedAppointment.dates?.find(d => d.date === format(selectedDate, 'yyyy-MM-dd'))?.voters?.split(',').map((voter, i) => (
                          <span key={i} className="px-3 py-1 bg-[#F5F5F0] rounded-full text-sm font-medium">
                            {voter}
                          </span>
                        )) || <p className="text-sm text-gray-400 italic">Chưa có ai vote ngày này.</p>}
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm text-gray-500">Nhấn vào ngày để thêm vào danh sách bình chọn.</p>
                  )}
                </motion.div>
              )}
            </motion.div>
          ) : (
            <div className="h-full min-h-[400px] flex flex-col items-center justify-center bg-white rounded-2xl border border-dashed border-gray-300 text-gray-400">
              <CalendarIcon size={48} className="mb-4 opacity-20" />
              <p>Chọn một buổi hẹn ở danh sách bên trái để bắt đầu vote</p>
            </div>
          )}
        </div>
      </div>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: #e5e7eb;
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: #d1d5db;
        }
      `}</style>
    </div>
  );
}
